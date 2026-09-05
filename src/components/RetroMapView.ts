import L from 'leaflet';
import { AppState, ActiveCheckboxes, PathItem } from '../state/AppState';

// Fast Axis-Aligned Bounding Box intersection check against Leaflet map bounds
export function isBBoxInBounds(bbox: [number, number, number, number], bounds: L.LatLngBounds): boolean {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const bSouth = bounds.getSouth();
  const bNorth = bounds.getNorth();
  const bWest = bounds.getWest();
  const bEast = bounds.getEast();

  // Check latitude overlap
  if (maxLat < bSouth || minLat > bNorth) return false;

  // Check longitude overlap (handling antimeridian wrap if east < west)
  if (bEast < bWest) {
    return maxLng >= bWest || minLng <= bEast;
  }
  return maxLng >= bWest && minLng <= bEast;
}

// Select pre-calculated LOD tier coordinates based on map zoom and user mode
export function getPathCoordinatesForZoom(
  p: PathItem,
  zoom: number,
  mode: 'auto' | 'low' | 'med' | 'high'
): [number, number][] {
  if (mode === 'low') {
    return p.lods?.low || p.coordinates;
  }
  if (mode === 'med') {
    return p.lods?.med || p.coordinates;
  }
  if (mode === 'high') {
    return p.coordinates;
  }

  // Auto mode based on zoom level:
  // Zoom 1-6 (world/continent): low tier (~2-5km tolerance)
  // Zoom 7-11 (state/region): med tier (~200m tolerance)
  // Zoom 12+ (city/neighborhood): high full detail tier (~15m tolerance)
  if (zoom <= 6) {
    return p.lods?.low || p.coordinates;
  } else if (zoom <= 11) {
    return p.lods?.med || p.coordinates;
  } else {
    return p.coordinates;
  }
}

export function getPlaceCategory(name: string, address: string = '') {
  const text = `${name} ${address}`.toLowerCase();

  if (/museum|gallery|exhibit|musee|museo|kunst|louvre|frick|smithsonian|metropolitan/.test(text)) {
    return { key: 'museums' as keyof ActiveCheckboxes, type: 'museum', icon: '🏛️', bg: '#D97706', border: '#1C1917', label: 'Museum' };
  }
  if (/cathedral|church|basilica|duomo|minster|abbey|chapel|st\.|saint|dom|kirche|eglise|sagrada|cathedrale/.test(text)) {
    return { key: 'cathedrals' as keyof ActiveCheckboxes, type: 'cathedral', icon: '⛪', bg: '#BE185D', border: '#1C1917', label: 'Cathedral / Church' };
  }
  if (/park|garden|botanical|nature|reserve|jardin|parc|forest|woods|canyon|national park|head-smashed-in/.test(text)) {
    return { key: 'parks' as keyof ActiveCheckboxes, type: 'park', icon: '🌲', bg: '#15803D', border: '#1C1917', label: 'Park / Garden' };
  }
  if (/restaurant|cafe|coffee|bakery|bistro|bar|pub|grill|diner|pizza|kitchen|trattoria/.test(text)) {
    return { key: 'food' as keyof ActiveCheckboxes, type: 'food', icon: '🍽️', bg: '#EA580C', border: '#1C1917', label: 'Food & Drink' };
  }
  return { key: 'general' as keyof ActiveCheckboxes, type: 'general', icon: '⭐', bg: '#F59E0B', border: '#1C1917', label: 'Saved Place' };
}

// Decorative Teardrop Pin HTML Generator
export function createDecorativePinHtml(icon: string, bg: string) {
  return `
    <div style="
      position: relative;
      width: 36px;
      height: 44px;
      filter: drop-shadow(3px 3px 0px #1C1917);
      cursor: pointer;
    ">
      <svg width="36" height="44" viewBox="0 0 36 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M18 0C8.05887 0 0 8.05887 0 18C0 30 18 44 18 44C18 44 36 30 36 18C36 8.05887 27.9411 0 18 0Z" fill="${bg}" stroke="#1C1917" stroke-width="2.5"/>
        <circle cx="18" cy="17" r="11" fill="#FFFDF9" stroke="#1C1917" stroke-width="1.5"/>
      </svg>
      <span style="
        position: absolute;
        top: 6px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 14px;
        line-height: 1;
        pointer-events: none;
      ">${icon}</span>
    </div>
  `;
}

export class RetroMapView extends HTMLElement {
  private map: L.Map | null = null;
  private timelineLayer: L.LayerGroup = L.layerGroup();
  private pathsLayer: L.LayerGroup = L.layerGroup();
  private savedPlacesLayer: L.LayerGroup = L.layerGroup();
  private myMapsLayer: L.LayerGroup = L.layerGroup();
  private currentRenderToken: number = 0;
  private pathRenderDebounceTimer: any = null;

  private onMapMoveOrZoom = () => {
    if (!AppState.categoryCheckboxes.timelinePaths) return;
    if (this.pathRenderDebounceTimer) {
      clearTimeout(this.pathRenderDebounceTimer);
    }
    this.pathRenderDebounceTimer = setTimeout(() => {
      this.renderPathsOnly();
    }, 60);
  };

  connectedCallback() {
    this.renderContainer();
    this.initMap();
    AppState.addEventListener('app-state-changed', () => {
      this.updateCheckboxUI();
      this.updateMapLayersProgressive();
      this.handleFocusedPlace();
    });
  }

  disconnectedCallback() {
    if (this.map) {
      this.map.off('moveend', this.onMapMoveOrZoom);
      this.map.off('zoomend', this.onMapMoveOrZoom);
    }
    if (this.pathRenderDebounceTimer) {
      clearTimeout(this.pathRenderDebounceTimer);
    }
  }

  calculateCounts() {
    const visits = AppState.timeline.visits.filter(v => AppState.isDateInRange(v.startTime));
    const paths = AppState.timeline.paths.filter(p => AppState.isDateInRange(p.startTime));
    const saved = AppState.places.savedPlaces.filter(p => AppState.isDateInRange(p.date));

    let museums = 0;
    let cathedrals = 0;
    let parks = 0;
    let food = 0;
    let general = 0;

    saved.forEach(p => {
      const cat = getPlaceCategory(p.name, p.address);
      if (cat.type === 'museum') museums++;
      else if (cat.type === 'cathedral') cathedrals++;
      else if (cat.type === 'park') parks++;
      else if (cat.type === 'food') food++;
      else general++;
    });

    let myMapsCount = 0;
    AppState.myMaps.forEach(m => {
      if (m.features) myMapsCount += m.features.length;
    });

    return {
      museums,
      cathedrals,
      parks,
      food,
      general,
      timelineVisits: visits.length,
      timelinePaths: paths.length,
      myMaps: myMapsCount,
    };
  }

  renderContainer() {
    const cb = AppState.categoryCheckboxes;
    const counts = this.calculateCounts();

    this.innerHTML = `
      <section class="paper-texture retro-border-lg retro-shadow p-6 mb-6">
        <!-- Map Header & Action Buttons -->
        <div class="flex flex-wrap items-center justify-between gap-4 border-b-2 border-stone-800 pb-3 mb-4">
          <div class="flex items-center gap-3">
            <span class="text-3xl text-retro-teal font-black">🗺️</span>
            <div>
              <h2 class="text-3xl font-extrabold uppercase text-retro-ink tracking-wider leading-none">
                Interactive Travel Map
              </h2>
              <p class="text-xs font-mono text-stone-600 mt-1">
                Visualizing Timeline Visits, Saved Places & My Maps (Progressive Non-Blocking Render)
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2 font-mono text-xs font-bold">
            <button id="open-places-table-btn" class="bg-retro-orange hover:bg-retro-orange-bright text-retro-paper px-3 py-1.5 retro-border retro-shadow-sm flex items-center gap-1.5">
              <span>📋</span> View Places Table Directory
            </button>
            <button id="select-all-btn" class="bg-retro-paper hover:bg-stone-200 text-retro-ink px-2.5 py-1.5 retro-border retro-shadow-sm">
              Select All
            </button>
            <button id="clear-all-btn" class="bg-retro-paper hover:bg-stone-200 text-retro-ink px-2.5 py-1.5 retro-border retro-shadow-sm">
              Clear All
            </button>
          </div>
        </div>

        <!-- Category Checkbox Filters Toolbar with Live Counts -->
        <div class="bg-retro-paper p-3.5 retro-border mb-4">
          <div class="flex items-center justify-between mb-2">
            <span class="font-mono text-xs font-extrabold uppercase text-retro-ink">
              Toggle Categories & Data Layers (Live Counts):
            </span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 font-mono text-xs">
            <label class="flex items-center justify-between p-1.5 retro-border bg-amber-50 cursor-pointer hover:bg-amber-100">
              <div class="flex items-center gap-1 truncate">
                <input type="checkbox" id="cb-museums" ${cb.museums ? 'checked' : ''} class="w-3.5 h-3.5 accent-amber-600 cursor-pointer" />
                <span class="font-bold text-retro-ink truncate">🏛️ Museums</span>
              </div>
              <span class="bg-amber-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1">${counts.museums}</span>
            </label>

            <label class="flex items-center justify-between p-1.5 retro-border bg-rose-50 cursor-pointer hover:bg-rose-100">
              <div class="flex items-center gap-1 truncate">
                <input type="checkbox" id="cb-cathedrals" ${cb.cathedrals ? 'checked' : ''} class="w-3.5 h-3.5 accent-rose-600 cursor-pointer" />
                <span class="font-bold text-retro-ink truncate">⛪ Cathedrals</span>
              </div>
              <span class="bg-rose-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1">${counts.cathedrals}</span>
            </label>

            <label class="flex items-center justify-between p-1.5 retro-border bg-emerald-50 cursor-pointer hover:bg-emerald-100">
              <div class="flex items-center gap-1 truncate">
                <input type="checkbox" id="cb-parks" ${cb.parks ? 'checked' : ''} class="w-3.5 h-3.5 accent-emerald-600 cursor-pointer" />
                <span class="font-bold text-retro-ink truncate">🌲 Parks</span>
              </div>
              <span class="bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1">${counts.parks}</span>
            </label>

            <label class="flex items-center justify-between p-1.5 retro-border bg-orange-50 cursor-pointer hover:bg-orange-100">
              <div class="flex items-center gap-1 truncate">
                <input type="checkbox" id="cb-food" ${cb.food ? 'checked' : ''} class="w-3.5 h-3.5 accent-orange-600 cursor-pointer" />
                <span class="font-bold text-retro-ink truncate">🍽️ Food</span>
              </div>
              <span class="bg-orange-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1">${counts.food}</span>
            </label>

            <label class="flex items-center justify-between p-1.5 retro-border bg-yellow-50 cursor-pointer hover:bg-yellow-100">
              <div class="flex items-center gap-1 truncate">
                <input type="checkbox" id="cb-general" ${cb.general ? 'checked' : ''} class="w-3.5 h-3.5 accent-yellow-600 cursor-pointer" />
                <span class="font-bold text-retro-ink truncate">⭐ Saved</span>
              </div>
              <span class="bg-yellow-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1">${counts.general}</span>
            </label>

            <label class="flex items-center justify-between p-1.5 retro-border bg-sky-50 cursor-pointer hover:bg-sky-100">
              <div class="flex items-center gap-1 truncate">
                <input type="checkbox" id="cb-timelineVisits" ${cb.timelineVisits ? 'checked' : ''} class="w-3.5 h-3.5 accent-sky-600 cursor-pointer" />
                <span class="font-bold text-retro-ink truncate">📍 Visits</span>
              </div>
              <span class="bg-sky-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1">${counts.timelineVisits}</span>
            </label>

            <label class="flex items-center justify-between p-1.5 retro-border bg-teal-50 cursor-pointer hover:bg-teal-100">
              <div class="flex items-center gap-1 truncate">
                <input type="checkbox" id="cb-timelinePaths" ${cb.timelinePaths ? 'checked' : ''} class="w-3.5 h-3.5 accent-teal-600 cursor-pointer" />
                <span class="font-bold text-retro-ink truncate">🛣️ Paths</span>
              </div>
              <span class="bg-teal-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1">${counts.timelinePaths}</span>
            </label>

            <label class="flex items-center justify-between p-1.5 retro-border bg-purple-50 cursor-pointer hover:bg-purple-100">
              <div class="flex items-center gap-1 truncate">
                <input type="checkbox" id="cb-myMaps" ${cb.myMaps ? 'checked' : ''} class="w-3.5 h-3.5 accent-purple-600 cursor-pointer" />
                <span class="font-bold text-retro-ink truncate">🗺️ My Maps</span>
              </div>
              <span class="bg-purple-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1">${counts.myMaps}</span>
            </label>
          </div>

          <!-- Path Level of Detail (LOD) & Performance Toolbar -->
          <div id="path-lod-toolbar" class="mt-2.5 pt-2.5 border-t border-stone-300 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-extrabold uppercase text-retro-ink flex items-center gap-1">
                <span>⚡</span> Path Detail:
              </span>
              <div class="inline-flex rounded-none shadow-sm retro-border-sm bg-stone-100 p-0.5" role="group">
                <button type="button" data-mode="auto" class="path-mode-btn px-2 py-0.5 font-bold ${AppState.pathResolutionMode === 'auto' ? 'bg-retro-teal text-white' : 'hover:bg-stone-200 text-stone-700'} cursor-pointer">Auto (Zoom-Aware)</button>
                <button type="button" data-mode="low" class="path-mode-btn px-2 py-0.5 font-bold ${AppState.pathResolutionMode === 'low' ? 'bg-retro-teal text-white' : 'hover:bg-stone-200 text-stone-700'} cursor-pointer">Low (Fast)</button>
                <button type="button" data-mode="med" class="path-mode-btn px-2 py-0.5 font-bold ${AppState.pathResolutionMode === 'med' ? 'bg-retro-teal text-white' : 'hover:bg-stone-200 text-stone-700'} cursor-pointer">Medium</button>
                <button type="button" data-mode="high" class="path-mode-btn px-2 py-0.5 font-bold ${AppState.pathResolutionMode === 'high' ? 'bg-retro-teal text-white' : 'hover:bg-stone-200 text-stone-700'} cursor-pointer">High Detail</button>
              </div>
              <label class="flex items-center gap-1 cursor-pointer select-none bg-stone-100 px-2 py-0.5 retro-border-sm hover:bg-stone-200">
                <input type="checkbox" id="cb-cull-viewport" ${AppState.pathViewportOnly ? 'checked' : ''} class="w-3.5 h-3.5 accent-teal-600 cursor-pointer" />
                <span class="font-bold text-stone-700">Cull Off-Screen</span>
              </label>
            </div>
            <div id="path-live-stats" class="text-[11px] font-mono px-2 py-1 bg-amber-50 text-stone-700 retro-border-sm">
              <span class="text-stone-400 italic">Initializing paths...</span>
            </div>
          </div>
        </div>

        <!-- Leaflet Map Container -->
        <div id="leaflet-map-container" class="w-full h-[580px] retro-border retro-shadow-sm retro-map-tiles relative z-0"></div>

        <!-- Decorative Map Legend -->
        <div class="mt-4 flex flex-wrap items-center justify-between text-xs font-mono gap-4 bg-retro-paper p-3 retro-border">
          <div class="flex flex-wrap items-center gap-3">
            <span class="font-bold uppercase text-retro-ink mr-1">Decorative Pins:</span>
            <span class="flex items-center gap-1 font-bold">
              <span class="w-5 h-5 rounded-full bg-[#D97706] text-white flex items-center justify-center text-[10px] retro-border-sm">🏛️</span> Museums
            </span>
            <span class="flex items-center gap-1 font-bold">
              <span class="w-5 h-5 rounded-full bg-[#BE185D] text-white flex items-center justify-center text-[10px] retro-border-sm">⛪</span> Cathedrals
            </span>
            <span class="flex items-center gap-1 font-bold">
              <span class="w-5 h-5 rounded-full bg-[#15803D] text-white flex items-center justify-center text-[10px] retro-border-sm">🌲</span> Parks
            </span>
            <span class="flex items-center gap-1 font-bold">
              <span class="w-5 h-5 rounded-full bg-[#F59E0B] text-white flex items-center justify-center text-[10px] retro-border-sm">⭐</span> Saved Places
            </span>
            <span class="flex items-center gap-1 font-bold">
              <span class="w-5 h-5 rounded-full bg-[#C2410C] text-white flex items-center justify-center text-[10px] retro-border-sm">📍</span> Timeline Visits
            </span>
          </div>

          <span class="text-retro-muted italic">⚡ Progressive Non-Blocking Map Animation</span>
        </div>
      </section>
    `;

    // Handlers
    const checkboxKeys: (keyof ActiveCheckboxes)[] = [
      'museums', 'cathedrals', 'parks', 'food', 'general', 'timelineVisits', 'timelinePaths', 'myMaps'
    ];

    checkboxKeys.forEach(key => {
      const input = this.querySelector(`#cb-${key}`) as HTMLInputElement;
      if (input) {
        input.addEventListener('change', () => {
          AppState.toggleCategoryCheckbox(key, input.checked);
        });
      }
    });

    // Path LOD Mode Buttons
    this.querySelectorAll('.path-mode-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const mode = target.dataset.mode as 'auto' | 'low' | 'med' | 'high';
        if (mode) {
          AppState.setPathResolutionMode(mode);
          this.renderPathsOnly();
          this.updatePathLodButtonsUI();
        }
      });
    });

    // Viewport Cull Checkbox
    const cullCheckbox = this.querySelector('#cb-cull-viewport') as HTMLInputElement;
    if (cullCheckbox) {
      cullCheckbox.addEventListener('change', () => {
        AppState.setPathViewportOnly(cullCheckbox.checked);
        this.renderPathsOnly();
      });
    }

    this.querySelector('#select-all-btn')?.addEventListener('click', () => AppState.setAllCategoryCheckboxes(true));
    this.querySelector('#clear-all-btn')?.addEventListener('click', () => AppState.setAllCategoryCheckboxes(false));
    this.querySelector('#open-places-table-btn')?.addEventListener('click', () => AppState.togglePlacesModal(true));
  }

  updateCheckboxUI() {
    const cb = AppState.categoryCheckboxes;
    Object.keys(cb).forEach(key => {
      const input = this.querySelector(`#cb-${key}`) as HTMLInputElement;
      if (input) {
        input.checked = cb[key as keyof ActiveCheckboxes];
      }
    });
    this.updatePathLodButtonsUI();
  }

  handleFocusedPlace() {
    if (!this.map || !AppState.focusedPlace) return;
    const { coordinates } = AppState.focusedPlace;
    const [lng, lat] = coordinates;
    if (!isNaN(lat) && !isNaN(lng)) {
      this.map.setView([lat, lng], 14, { animate: true });
      AppState.focusedPlace = null;
    }
  }

  initMap() {
    const container = this.querySelector('#leaflet-map-container') as HTMLElement;
    if (!container || this.map) return;

    this.map = L.map(container, {
      center: [49.45, -123.72],
      zoom: 6,
      zoomControl: true,
      preferCanvas: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors | Retro Revival Theme',
    }).addTo(this.map);

    this.timelineLayer.addTo(this.map);
    this.pathsLayer.addTo(this.map);
    this.savedPlacesLayer.addTo(this.map);
    this.myMapsLayer.addTo(this.map);

    this.map.on('moveend', this.onMapMoveOrZoom);
    this.map.on('zoomend', this.onMapMoveOrZoom);

    this.updateMapLayersProgressive();
  }

  // Progressive non-blocking map rendering using animation frames (100 markers / 16ms tick)
  async updateMapLayersProgressive() {
    if (!this.map) return;

    // Increment render token to invalidate any previous ongoing animation frame loops
    const renderToken = ++this.currentRenderToken;

    this.timelineLayer.clearLayers();
    this.savedPlacesLayer.clearLayers();
    this.myMapsLayer.clearLayers();

    const cb = AppState.categoryCheckboxes;
    const bounds: L.LatLngBounds = L.latLngBounds([]);

    // 1. Prepare Saved Places & Reviews
    const placesToRender: { p: any; catInfo: any }[] = [];
    if (cb.museums || cb.cathedrals || cb.parks || cb.food || cb.general) {
      const places = AppState.places.savedPlaces.filter(p => AppState.isDateInRange(p.date));
      places.forEach(p => {
        const catInfo = getPlaceCategory(p.name, p.address);
        if (cb[catInfo.key]) {
          placesToRender.push({ p, catInfo });
        }
      });
    }

    // Render Saved Places in batches of 75 per frame
    const placeBatchSize = 75;
    for (let i = 0; i < placesToRender.length; i += placeBatchSize) {
      if (this.currentRenderToken !== renderToken) return;

      const batch = placesToRender.slice(i, i + placeBatchSize);
      batch.forEach(({ p, catInfo }) => {
        const [lng, lat] = p.coordinates;
        if (!isNaN(lat) && !isNaN(lng)) {
          const latLng = L.latLng(lat, lng);
          bounds.extend(latLng);

          const customIcon = L.divIcon({
            className: `custom-retro-${catInfo.type}-pin`,
            html: createDecorativePinHtml(catInfo.icon, catInfo.bg),
            iconSize: [36, 44],
            iconAnchor: [18, 44],
          });

          const marker = L.marker(latLng, { icon: customIcon });
          marker.bindPopup(`
            <div class="font-sans p-1 text-retro-ink">
              <div class="flex items-center gap-1.5 mb-1">
                <span class="text-base">${catInfo.icon}</span>
                <span class="text-[10px] font-mono uppercase font-bold px-1.5 py-0.5 text-white border" style="background-color: ${catInfo.bg}; border-color: ${catInfo.border}">${catInfo.label}</span>
              </div>
              <strong class="text-sm font-bold text-retro-ink block">${p.name}</strong>
              <span class="text-xs text-stone-600 block mb-1.5">${p.address || ''}</span>
              ${p.url ? `<a href="${p.url}" target="_blank" class="text-xs text-retro-teal underline font-bold">Open in Google Maps &rarr;</a>` : ''}
            </div>
          `);
          this.savedPlacesLayer.addLayer(marker);
        }
      });

      await new Promise(r => requestAnimationFrame(r));
    }

    // 2. Prepare Timeline Visits with Spatial Bucket Quantization
    if (cb.timelineVisits) {
      const visits = AppState.timeline.visits.filter(v => AppState.isDateInRange(v.startTime));
      const locationBuckets = new Map<string, { lat: number; lng: number; name: string; count: number; address: string; time: string }>();

      visits.forEach(v => {
        const [lng, lat] = v.coordinates;
        if (!isNaN(lat) && !isNaN(lng)) {
          const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
          if (!locationBuckets.has(key)) {
            locationBuckets.set(key, { lat, lng, name: v.name, count: 1, address: v.address, time: v.startTime });
          } else {
            locationBuckets.get(key)!.count += 1;
          }
        }
      });

      const bucketList = Array.from(locationBuckets.values());
      const visitBatchSize = 100;

      for (let i = 0; i < bucketList.length; i += visitBatchSize) {
        if (this.currentRenderToken !== renderToken) return;

        const batch = bucketList.slice(i, i + visitBatchSize);
        batch.forEach(loc => {
          const latLng = L.latLng(loc.lat, loc.lng);
          bounds.extend(latLng);

          const marker = L.circleMarker(latLng, {
            radius: loc.count > 10 ? 8 : (loc.count > 2 ? 6 : 5),
            fillColor: '#C2410C',
            color: '#1C1917',
            weight: 1.5,
            fillOpacity: 0.85,
            renderer: L.canvas(),
          });

          marker.bindPopup(`
            <div class="font-sans p-1 text-retro-ink">
              <strong class="text-sm font-bold text-retro-orange block">📍 ${loc.name}</strong>
              <span class="text-xs text-stone-600 block mb-1">${loc.address || ''}</span>
              <span class="text-[11px] font-mono bg-stone-100 p-1 block border">Recorded Visits: <strong>${loc.count}</strong></span>
            </div>
          `);
          this.timelineLayer.addLayer(marker);
        });

        await new Promise(r => requestAnimationFrame(r));
      }
    }

    // 3. Render Timeline Paths with Viewport Culling and Dynamic LOD
    if (cb.timelinePaths) {
      const paths = AppState.timeline.paths.filter(p => AppState.isDateInRange(p.startTime));
      for (let i = 0; i < Math.min(paths.length, 50); i++) {
        const b = paths[i].bbox;
        if (b) {
          bounds.extend([b[1], b[0]]);
          bounds.extend([b[3], b[2]]);
        }
      }
      this.renderPathsOnly();
    } else {
      this.pathsLayer.clearLayers();
      this.updatePathStatsUI(0, 0, 0, 0);
    }

    // 4. Prepare My Maps Features
    if (cb.myMaps) {
      AppState.myMaps.forEach(mapObj => {
        if (mapObj.features && Array.isArray(mapObj.features)) {
          mapObj.features.forEach(feat => {
            const geom = feat.geometry;
            if (!geom) return;

            if (geom.type === 'Point' && geom.coordinates) {
              const [lng, lat] = geom.coordinates;
              if (!isNaN(lat) && !isNaN(lng)) {
                const latLng = L.latLng(lat, lng);
                bounds.extend(latLng);

                const customIcon = L.divIcon({
                  className: 'custom-retro-mymaps-pin',
                  html: createDecorativePinHtml('🗺️', '#9333EA'),
                  iconSize: [36, 44],
                  iconAnchor: [18, 44],
                });

                const marker = L.marker(latLng, { icon: customIcon });

                marker.bindPopup(`
                  <div class="font-sans p-1">
                    <span class="text-[10px] font-mono uppercase bg-purple-100 text-purple-800 px-1 border">${mapObj.mapName}</span>
                    <strong class="text-sm font-bold block mt-1">${feat.properties?.name || 'KML Marker'}</strong>
                    <span class="text-xs text-stone-600">${feat.properties?.description || ''}</span>
                  </div>
                `);
                this.myMapsLayer.addLayer(marker);
              }
            } else if (geom.type === 'LineString' && geom.coordinates) {
              const latLngs = geom.coordinates.map(([lng, lat]: [number, number]) => L.latLng(lat, lng));
              if (latLngs.length > 1) {
                latLngs.forEach((ll: L.LatLng) => bounds.extend(ll));
                const polyline = L.polyline(latLngs, {
                  color: '#9333EA',
                  weight: 4,
                  opacity: 0.85,
                  renderer: L.canvas(),
                });
                this.myMapsLayer.addLayer(polyline);
              }
            }
          });
        }
      });
    }

    // Fit map bounds if markers/paths exist
    if (bounds.isValid() && this.currentRenderToken === renderToken) {
      this.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  }

  renderPathsOnly() {
    if (!this.map) return;
    this.pathsLayer.clearLayers();

    if (!AppState.categoryCheckboxes.timelinePaths) {
      this.updatePathStatsUI(0, 0, 0, 0);
      return;
    }

    const currentZoom = this.map.getZoom();
    const bounds = this.map.getBounds();
    const allPaths = AppState.timeline.paths.filter(p => AppState.isDateInRange(p.startTime));
    const totalCount = allPaths.length;

    const viewportOnly = AppState.pathViewportOnly;
    const mode = AppState.pathResolutionMode;

    let candidatePaths = allPaths;
    if (viewportOnly) {
      candidatePaths = allPaths.filter(p => {
        if (!p.bbox) return true;
        return isBBoxInBounds(p.bbox, bounds);
      });
    }

    const inViewCount = candidatePaths.length;
    const multiLatLngs: [number, number][][] = [];
    let renderedPointsCount = 0;
    let originalPointsCount = 0;

    for (let i = 0; i < candidatePaths.length; i++) {
      const p = candidatePaths[i];
      originalPointsCount += p.coordinates.length;
      const coords = getPathCoordinatesForZoom(p, currentZoom, mode);
      if (coords.length > 1) {
        renderedPointsCount += coords.length;
        const latLngs: [number, number][] = new Array(coords.length);
        for (let j = 0; j < coords.length; j++) {
          latLngs[j] = [coords[j][1], coords[j][0]];
        }
        multiLatLngs.push(latLngs);
      }
    }

    // Adaptive Canvas Styling:
    // When zoomed in (zoom >= 12) with a small count of visible paths, use retro dashed styling
    // In broad/macro views or large path sets, solid stroke renders >5-10x faster
    const isDashed = currentZoom >= 12 && multiLatLngs.length <= 75;

    if (multiLatLngs.length > 0) {
      const polyline = L.polyline(multiLatLngs, {
        color: '#0D9488',
        weight: currentZoom >= 14 ? 3.5 : (currentZoom >= 10 ? 3 : 2),
        opacity: 0.85,
        dashArray: isDashed ? '6, 6' : undefined,
        renderer: L.canvas(),
      });
      this.pathsLayer.addLayer(polyline);
    }

    this.updatePathStatsUI(inViewCount, totalCount, renderedPointsCount, originalPointsCount);
  }

  updatePathStatsUI(inView: number, total: number, renderedPoints: number, originalPoints: number) {
    const statsEl = this.querySelector('#path-live-stats');
    if (!statsEl) return;

    if (!AppState.categoryCheckboxes.timelinePaths) {
      statsEl.innerHTML = `<span class="text-stone-400 italic">🛣️ Timeline Paths disabled</span>`;
      return;
    }

    const zoom = this.map ? this.map.getZoom() : 6;
    const mode = AppState.pathResolutionMode;
    let modeLabel = mode.toUpperCase();
    if (mode === 'auto') {
      if (zoom <= 6) modeLabel = `AUTO (Low • Z${zoom})`;
      else if (zoom <= 11) modeLabel = `AUTO (Med • Z${zoom})`;
      else modeLabel = `AUTO (High • Z${zoom})`;
    }

    const reduction = originalPoints > 0 ? Math.round((1 - renderedPoints / originalPoints) * 100) : 0;

    statsEl.innerHTML = `
      <span class="font-bold text-retro-teal">LOD:</span> <span class="font-extrabold text-stone-800">${modeLabel}</span>
      <span class="mx-1 text-stone-300">|</span>
      <span class="font-bold text-stone-700">Paths in View:</span> <strong class="text-retro-ink">${inView.toLocaleString()}</strong> / ${total.toLocaleString()}
      <span class="mx-1 text-stone-300">|</span>
      <span class="font-bold text-stone-700">Points:</span> <strong>${renderedPoints.toLocaleString()}</strong>
      <span class="text-emerald-700 font-bold">(${reduction}% culled)</span>
    `;
  }

  updatePathLodButtonsUI() {
    const currentMode = AppState.pathResolutionMode;
    this.querySelectorAll('.path-mode-btn').forEach(btn => {
      const el = btn as HTMLElement;
      if (el.dataset.mode === currentMode) {
        el.className = 'path-mode-btn px-2 py-0.5 font-bold bg-retro-teal text-white cursor-pointer';
      } else {
        el.className = 'path-mode-btn px-2 py-0.5 font-bold hover:bg-stone-200 text-stone-700 cursor-pointer';
      }
    });

    const cullCheckbox = this.querySelector('#cb-cull-viewport') as HTMLInputElement;
    if (cullCheckbox) {
      cullCheckbox.checked = AppState.pathViewportOnly;
    }
  }
}

customElements.define('retro-map-view', RetroMapView);
