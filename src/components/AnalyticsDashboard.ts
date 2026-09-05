import { AppState } from '../state/AppState';

export class AnalyticsDashboard extends HTMLElement {
  connectedCallback() {
    this.render();
    AppState.addEventListener('app-state-changed', () => this.render());
  }

  render() {
    if (AppState.isLoading) {
      this.innerHTML = `
        <div class="paper-texture retro-border-lg retro-shadow p-8 mb-6">
          <div class="max-w-xl mx-auto text-center">
            <h3 class="font-display text-3xl text-retro-ochre uppercase mb-2">
              Loading Retro Travel Archives...
            </h3>
            <p class="font-mono text-xs text-retro-ink mb-3 font-bold">
              ${AppState.loadingStatusMessage}
            </p>
            <div class="w-full bg-stone-200 h-5 retro-border overflow-hidden p-0.5">
              <div class="bg-retro-orange h-full transition-all duration-200 flex items-center justify-center font-mono text-[10px] text-white font-bold" style="width: ${AppState.loadingProgress}%">
                ${AppState.loadingProgress}%
              </div>
            </div>
            <p class="font-mono text-[11px] text-stone-500 mt-3 italic">
              ⚡ Main-thread non-blocking batch chunking enabled to prevent browser crashes.
            </p>
          </div>
        </div>
      `;
      return;
    }

    const { visits, activities } = AppState.timeline;
    const { savedPlaces } = AppState.places;

    // Filter items by Master Time Selector
    const filteredVisits = visits.filter(v => AppState.isDateInRange(v.startTime));
    const filteredActivities = activities.filter(a => AppState.isDateInRange(a.startTime));
    const filteredPlaces = savedPlaces.filter(p => AppState.isDateInRange(p.date));

    const hasTimeline = AppState.dataStatus.hasTimeline;
    const hasPlaces = AppState.dataStatus.hasSavedPlaces || AppState.dataStatus.hasReviews;

    // Calculate modality distances
    let walkMeters = 0;
    let driveMeters = 0;
    let flyMeters = 0;
    let otherMeters = 0;

    filteredActivities.forEach(act => {
      const type = (act.activityType || '').toUpperCase();
      const dist = act.distanceMeters || 0;
      if (type.includes('WALK') || type.includes('RUN') || type.includes('FOOT') || type.includes('HIKE')) {
        walkMeters += dist;
      } else if (type.includes('VEHICLE') || type.includes('DRIV') || type.includes('CAR') || type.includes('MOTOR') || type.includes('BUS')) {
        driveMeters += dist;
      } else if (type.includes('FLY') || type.includes('PLANE') || type.includes('AIR')) {
        flyMeters += dist;
      } else {
        otherMeters += dist;
      }
    });

    const walkKm = (walkMeters / 1000).toFixed(1);
    const driveKm = (driveMeters / 1000).toFixed(1);
    const flyKm = (flyMeters / 1000).toFixed(1);
    const totalKm = ((walkMeters + driveMeters + flyMeters + otherMeters) / 1000).toFixed(1);

    // Calculate unique cities/towns
    const citiesSet = new Set<string>();
    filteredVisits.forEach(v => {
      if (v.address) {
        const parts = v.address.split(',');
        if (parts.length >= 2) {
          citiesSet.add(parts[parts.length - 2].trim());
        }
      }
    });
    filteredPlaces.forEach(p => {
      if (p.address) {
        const parts = p.address.split(',');
        if (parts.length >= 2) {
          citiesSet.add(parts[parts.length - 2].trim());
        }
      }
    });

    // Calculate top frequented places
    const placeFrequencyMap: { [name: string]: { count: number; address: string; isSaved: boolean } } = {};
    filteredVisits.forEach(v => {
      const name = v.name || 'Unknown Location';
      const isSaved = savedPlaces.some(sp => sp.name.toLowerCase() === name.toLowerCase());
      if (!placeFrequencyMap[name]) {
        placeFrequencyMap[name] = { count: 0, address: v.address, isSaved };
      }
      placeFrequencyMap[name].count += 1;
    });

    const topPlaces = Object.entries(placeFrequencyMap)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5);

    const tripCount = filteredVisits.length > 0 ? Math.ceil(filteredVisits.length / 4) : filteredPlaces.length;

    this.innerHTML = `
      <section class="paper-texture retro-border-lg retro-shadow p-6 mb-6">
        <div class="flex items-center justify-between border-b-2 border-stone-800 pb-3 mb-6">
          <div class="flex items-center gap-3">
            <span class="text-3xl text-retro-orange font-black">📊</span>
            <h2 class="text-3xl font-extrabold uppercase text-retro-ink tracking-wider">
              Travel Analytics & Summary
            </h2>
          </div>
          <span class="text-xs font-mono uppercase bg-retro-sky text-retro-ink px-3 py-1 retro-border font-bold">
            ${AppState.datePreset.toUpperCase()} VIEW
          </span>
        </div>

        ${(!hasTimeline && !hasPlaces) ? `
          <div class="bg-retro-paper border-2 border-dashed border-stone-400 p-8 text-center rounded">
            <h3 class="text-2xl font-bold text-retro-orange mb-2">No Travel Data Uploaded Yet</h3>
            <p class="text-retro-muted max-w-md mx-auto mb-4 text-sm">
              Upload your Google Takeout ZIP or JSON/KMZ files to generate your retro analytics dashboard and interactive travel maps.
            </p>
            <button id="dashboard-upload-btn" class="bg-retro-orange text-retro-paper font-display text-lg px-6 py-2 retro-border retro-shadow hover:bg-retro-orange-bright">
              Upload Google Takeout
            </button>
          </div>
        ` : `
          <!-- Metric Cards Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div class="bg-retro-paper p-4 retro-border retro-shadow-sm flex flex-col justify-between">
              <span class="text-xs font-mono font-bold uppercase text-retro-muted">Unique Cities / Towns</span>
              <div class="flex items-baseline justify-between mt-2">
                <span class="text-4xl font-extrabold text-retro-ochre font-display">${citiesSet.size}</span>
                <span class="text-xl">🏙️</span>
              </div>
              <p class="text-[11px] text-retro-muted mt-2 font-mono">Discovered across places & visits</p>
            </div>

            <div class="bg-retro-paper p-4 retro-border retro-shadow-sm flex flex-col justify-between">
              <span class="text-xs font-mono font-bold uppercase text-retro-muted">Total Distance</span>
              <div class="flex items-baseline justify-between mt-2">
                <span class="text-4xl font-extrabold text-retro-orange font-display">${totalKm}</span>
                <span class="text-sm font-bold font-mono text-retro-ink">KM</span>
              </div>
              <p class="text-[11px] text-retro-muted mt-2 font-mono">${hasTimeline ? 'Aggregated across all modalities' : 'Requires Timeline JSON'}</p>
            </div>

            <div class="bg-retro-paper p-4 retro-border retro-shadow-sm flex flex-col justify-between">
              <span class="text-xs font-mono font-bold uppercase text-retro-muted">Outings / Trips</span>
              <div class="flex items-baseline justify-between mt-2">
                <span class="text-4xl font-extrabold text-retro-teal font-display">${tripCount}</span>
                <span class="text-xl">🧳</span>
              </div>
              <p class="text-[11px] text-retro-muted mt-2 font-mono">Discrete activity segments</p>
            </div>

            <div class="bg-retro-paper p-4 retro-border retro-shadow-sm flex flex-col justify-between">
              <span class="text-xs font-mono font-bold uppercase text-retro-muted">Saved Places</span>
              <div class="flex items-baseline justify-between mt-2">
                <span class="text-4xl font-extrabold text-retro-ink font-display">${filteredPlaces.length}</span>
                <span class="text-xl">⭐</span>
              </div>
              <p class="text-[11px] text-retro-muted mt-2 font-mono">Starred or pinned location markers</p>
            </div>
          </div>

          <!-- Modality Breakdown & Top Places Grid -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Modality Breakdown Card -->
            <div class="bg-retro-paper p-5 retro-border retro-shadow-sm">
              <h3 class="text-xl font-bold uppercase text-retro-ink border-b border-stone-300 pb-2 mb-4 flex items-center justify-between">
                <span>Distance by Travel Modality</span>
                <span class="text-xs font-mono font-normal text-retro-muted">KMs Covered</span>
              </h3>

              ${hasTimeline ? `
                <div class="space-y-4 text-sm font-mono">
                  <div>
                    <div class="flex justify-between mb-1">
                      <span class="font-bold text-retro-teal flex items-center gap-1">🚶 Walk / Hike</span>
                      <span>${walkKm} KM</span>
                    </div>
                    <div class="w-full bg-stone-200 h-3 retro-border overflow-hidden">
                      <div class="bg-retro-teal h-full" style="width: ${Math.min(100, (walkMeters / (parseFloat(totalKm) * 10 || 1)) * 100)}%"></div>
                    </div>
                  </div>

                  <div>
                    <div class="flex justify-between mb-1">
                      <span class="font-bold text-retro-orange flex items-center gap-1">🚗 Driving / Transit</span>
                      <span>${driveKm} KM</span>
                    </div>
                    <div class="w-full bg-stone-200 h-3 retro-border overflow-hidden">
                      <div class="bg-retro-orange h-full" style="width: ${Math.min(100, (driveMeters / (parseFloat(totalKm) * 10 || 1)) * 100)}%"></div>
                    </div>
                  </div>

                  <div>
                    <div class="flex justify-between mb-1">
                      <span class="font-bold text-retro-ochre flex items-center gap-1">✈ Flight / Air</span>
                      <span>${flyKm} KM</span>
                    </div>
                    <div class="w-full bg-stone-200 h-3 retro-border overflow-hidden">
                      <div class="bg-retro-ochre h-full" style="width: ${Math.min(100, (flyMeters / (parseFloat(totalKm) * 10 || 1)) * 100)}%"></div>
                    </div>
                  </div>
                </div>
              ` : `
                <p class="text-xs font-mono text-retro-muted italic py-6 text-center">
                  Timeline activity data is not available. Upload Timeline.json to see modality metrics.
                </p>
              `}
            </div>

            <!-- Top Frequented Places Card -->
            <div class="bg-retro-paper p-5 retro-border retro-shadow-sm">
              <h3 class="text-xl font-bold uppercase text-retro-ink border-b border-stone-300 pb-2 mb-4">
                Most Frequented Locations
              </h3>

              ${topPlaces.length > 0 ? `
                <ul class="space-y-3">
                  ${topPlaces.map(([name, info]) => `
                    <li class="flex items-center justify-between p-2 retro-border bg-retro-paper-card">
                      <div class="truncate mr-2">
                        <span class="font-bold text-retro-ink block text-sm truncate">${name}</span>
                        <span class="text-[11px] text-retro-muted block truncate font-mono">${info.address || 'Coordinates Recorded'}</span>
                      </div>
                      <div class="flex items-center gap-2 flex-shrink-0">
                        ${info.isSaved ? `<span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 border border-amber-400">★ Saved</span>` : ''}
                        <span class="bg-retro-ochre text-retro-paper text-xs font-bold px-2 py-0.5 retro-border">
                          ${info.count} visits
                        </span>
                      </div>
                    </li>
                  `).join('')}
                </ul>
              ` : `
                <p class="text-xs font-mono text-retro-muted italic py-6 text-center">
                  No visit activity recorded for the selected time range.
                </p>
              `}
            </div>
          </div>
        `}
      </section>
    `;

    this.querySelector('#dashboard-upload-btn')?.addEventListener('click', () => {
      AppState.toggleUploadModal(true);
    });
  }
}

customElements.define('analytics-dashboard', AnalyticsDashboard);
