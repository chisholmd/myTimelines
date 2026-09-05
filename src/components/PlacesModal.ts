import { AppState } from '../state/AppState';
import { getPlaceCategory } from './RetroMapView';

export class PlacesModal extends HTMLElement {
  private searchQuery = '';
  private activeCategoryFilter = 'all';

  connectedCallback() {
    this.render();
    AppState.addEventListener('app-state-changed', () => {
      this.activeCategoryFilter = AppState.placesModalCategoryFilter || 'all';
      this.render();
    });
  }

  render() {
    const isOpen = AppState.isPlacesModalOpen;
    if (!isOpen) {
      this.innerHTML = '';
      return;
    }

    // Collect all places from Saved Places & Timeline Visits within date range
    const saved = AppState.places.savedPlaces
      .filter(p => AppState.isDateInRange(p.date))
      .map(p => {
        const cat = getPlaceCategory(p.name, p.address);
        return {
          id: `saved-${p.name}-${p.coordinates.join(',')}`,
          name: p.name,
          address: p.address,
          countryCode: p.countryCode,
          categoryKey: cat.key,
          categoryLabel: cat.label,
          categoryIcon: cat.icon,
          categoryBg: cat.bg,
          date: p.date,
          url: p.url,
          coordinates: p.coordinates,
          source: 'Saved Place'
        };
      });

    const visits = AppState.timeline.visits
      .filter(v => AppState.isDateInRange(v.startTime))
      .map(v => {
        const cat = getPlaceCategory(v.name, v.address);
        return {
          id: `visit-${v.name}-${v.coordinates.join(',')}`,
          name: v.name,
          address: v.address,
          countryCode: '',
          categoryKey: cat.key,
          categoryLabel: 'Timeline Visit',
          categoryIcon: '📍',
          categoryBg: '#C2410C',
          date: v.startTime,
          url: null,
          coordinates: v.coordinates,
          source: 'Timeline'
        };
      });

    const allItems = [...saved, ...visits];

    // Filter by category and search query
    const filteredItems = allItems.filter(item => {
      // Category match
      if (this.activeCategoryFilter !== 'all') {
        if (this.activeCategoryFilter === 'museums' && item.categoryKey !== 'museums') return false;
        if (this.activeCategoryFilter === 'cathedrals' && item.categoryKey !== 'cathedrals') return false;
        if (this.activeCategoryFilter === 'parks' && item.categoryKey !== 'parks') return false;
        if (this.activeCategoryFilter === 'food' && item.categoryKey !== 'food') return false;
        if (this.activeCategoryFilter === 'general' && item.categoryKey !== 'general') return false;
        if (this.activeCategoryFilter === 'visits' && item.source !== 'Timeline') return false;
      }

      // Search match
      if (this.searchQuery) {
        const q = this.searchQuery.toLowerCase();
        const matchName = item.name.toLowerCase().includes(q);
        const matchAddr = item.address.toLowerCase().includes(q);
        const matchCat = item.categoryLabel.toLowerCase().includes(q);
        return matchName || matchAddr || matchCat;
      }

      return true;
    });

    this.innerHTML = `
      <div class="fixed inset-0 bg-stone-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-6">
        <div class="paper-texture retro-border-lg retro-shadow-lg w-full max-w-6xl max-h-[92vh] flex flex-col p-4 sm:p-6 relative">
          <!-- Modal Header -->
          <div class="flex items-center justify-between border-b-2 border-stone-800 pb-3 mb-4 flex-shrink-0">
            <div class="flex items-center gap-3">
              <span class="text-3xl text-retro-ochre font-black">📋</span>
              <div>
                <h3 class="text-2xl sm:text-3xl font-extrabold uppercase text-retro-ink tracking-wider leading-tight">
                  Places Directory & Location Finder
                </h3>
                <p class="text-xs font-mono text-stone-600">
                  Total Locations: <strong class="text-retro-orange">${allItems.length}</strong> | Matching Filter: <strong class="text-retro-teal">${filteredItems.length}</strong>
                </p>
              </div>
            </div>
            <button id="close-places-modal-btn" class="text-2xl font-black text-retro-ink hover:text-retro-orange px-3 py-1 border-2 border-stone-800 bg-retro-paper">
              ×
            </button>
          </div>

          <!-- Filter Toolbar: Search Input & Category Pills -->
          <div class="flex flex-wrap items-center justify-between gap-3 mb-4 flex-shrink-0 bg-retro-paper p-3 retro-border">
            <!-- Search Bar -->
            <div class="relative flex-1 min-w-[240px]">
              <input 
                type="text" 
                id="modal-search-input" 
                placeholder="Search place name, city, address..." 
                value="${this.searchQuery}"
                class="w-full bg-retro-paper-card retro-border p-2 pl-8 font-mono text-xs text-retro-ink focus:outline-none focus:bg-white"
              />
              <span class="absolute left-2.5 top-2.5 text-xs">🔍</span>
            </div>

            <!-- Category Pills -->
            <div class="flex flex-wrap items-center gap-1.5 font-mono text-xs">
              ${[
                { id: 'all', label: `All (${allItems.length})` },
                { id: 'museums', label: `🏛️ Museums (${allItems.filter(i => i.categoryKey === 'museums').length})` },
                { id: 'cathedrals', label: `⛪ Cathedrals (${allItems.filter(i => i.categoryKey === 'cathedrals').length})` },
                { id: 'parks', label: `🌲 Parks (${allItems.filter(i => i.categoryKey === 'parks').length})` },
                { id: 'food', label: `🍽️ Food (${allItems.filter(i => i.categoryKey === 'food').length})` },
                { id: 'visits', label: `📍 Visits (${visits.length})` },
              ].map(cat => `
                <button data-cat="${cat.id}" class="modal-cat-pill px-2.5 py-1 retro-border font-bold uppercase transition-all ${
                  this.activeCategoryFilter === cat.id 
                    ? 'bg-retro-orange text-retro-paper retro-shadow-sm' 
                    : 'bg-retro-paper hover:bg-stone-200 text-retro-ink'
                }">
                  ${cat.label}
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Table Container -->
          <div class="flex-1 overflow-y-auto retro-border bg-retro-paper-card">
            <table class="w-full text-left border-collapse font-sans text-xs">
              <thead class="bg-retro-paper sticky top-0 border-b-2 border-stone-800 font-mono uppercase text-[11px] font-bold text-retro-ink z-10">
                <tr>
                  <th class="p-3 w-12 text-center">Type</th>
                  <th class="p-3">Place Name</th>
                  <th class="p-3">Category</th>
                  <th class="p-3">Address / Location</th>
                  <th class="p-3">Date</th>
                  <th class="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-stone-300">
                ${filteredItems.length > 0 ? filteredItems.slice(0, 300).map(item => `
                  <tr class="hover:bg-amber-50/80 transition-colors">
                    <td class="p-3 text-center text-base">
                      <span class="inline-flex items-center justify-center w-7 h-7 rounded-full text-white border border-stone-800" style="background-color: ${item.categoryBg}">
                        ${item.categoryIcon}
                      </span>
                    </td>
                    <td class="p-3">
                      <strong class="font-bold text-sm text-retro-ink block">${item.name}</strong>
                      <span class="text-[10px] font-mono text-stone-500 uppercase">${item.source}</span>
                    </td>
                    <td class="p-3">
                      <span class="inline-block px-2 py-0.5 text-[10px] font-mono font-bold uppercase text-white border border-stone-800" style="background-color: ${item.categoryBg}">
                        ${item.categoryLabel}
                      </span>
                    </td>
                    <td class="p-3 text-stone-700 font-mono text-[11px]">
                      ${item.address || 'Coordinates Recorded'}
                    </td>
                    <td class="p-3 font-mono text-[11px] text-stone-600 whitespace-nowrap">
                      ${item.date ? new Date(item.date).toLocaleDateString() : 'N/A'}
                    </td>
                    <td class="p-3 text-right whitespace-nowrap space-x-1">
                      <button data-coords="${item.coordinates.join(',')}" data-name="${item.name}" class="focus-place-btn bg-retro-teal hover:bg-retro-teal-light text-white font-mono font-bold px-2.5 py-1 retro-border text-[11px]">
                        📍 Focus Map
                      </button>
                      ${item.url ? `
                        <a href="${item.url}" target="_blank" class="bg-retro-paper hover:bg-stone-200 text-retro-ink font-mono font-bold px-2 py-1 retro-border text-[11px] inline-block">
                          ↗ Maps
                        </a>
                      ` : ''}
                    </td>
                  </tr>
                `).join('') : `
                  <tr>
                    <td colspan="6" class="p-8 text-center font-mono text-stone-500 italic">
                      No place names found matching search criteria.
                    </td>
                  </tr>
                `}
              </tbody>
            </table>
          </div>

          <!-- Footer -->
          <div class="mt-4 flex justify-between items-center text-xs font-mono text-stone-600 flex-shrink-0">
            <span>Showing top ${Math.min(300, filteredItems.length)} of ${filteredItems.length} matching locations</span>
            <button id="close-modal-footer-btn" class="bg-retro-paper hover:bg-stone-200 text-retro-ink px-4 py-1.5 retro-border font-bold uppercase">
              Close Directory
            </button>
          </div>
        </div>
      </div>
    `;

    // Handlers
    this.querySelector('#close-places-modal-btn')?.addEventListener('click', () => AppState.togglePlacesModal(false));
    this.querySelector('#close-modal-footer-btn')?.addEventListener('click', () => AppState.togglePlacesModal(false));

    const searchInput = this.querySelector('#modal-search-input') as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = (e.target as HTMLInputElement).value;
        this.render();
      });
    }

    this.querySelectorAll('.modal-cat-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        const cat = (e.currentTarget as HTMLElement).dataset.cat || 'all';
        this.activeCategoryFilter = cat;
        this.render();
      });
    });

    this.querySelectorAll('.focus-place-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const coordsStr = target.dataset.coords;
        const name = target.dataset.name || 'Selected Location';
        if (coordsStr) {
          const parts = coordsStr.split(',').map(Number);
          if (parts.length === 2) {
            AppState.focusPlaceOnMap([parts[0], parts[1]], name);
          }
        }
      });
    });
  }
}

customElements.define('places-modal', PlacesModal);
