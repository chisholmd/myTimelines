import { AppState, DatePreset } from '../state/AppState';

export class MasterTimeSelector extends HTMLElement {
  connectedCallback() {
    this.render();
    AppState.addEventListener('app-state-changed', () => this.render());
  }

  render() {
    const currentPreset = AppState.datePreset;
    const presets: { id: DatePreset; label: string }[] = [
      { id: 'all', label: 'All-Time' },
      { id: 'today', label: 'Today' },
      { id: 'yesterday', label: 'Yesterday' },
      { id: 'week', label: 'This Week' },
      { id: 'month', label: 'This Month' },
      { id: 'year', label: 'This Year' },
      { id: 'custom', label: 'Custom' },
    ];

    this.innerHTML = `
      <section class="paper-texture retro-border-lg retro-shadow p-4 mb-6">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-2">
            <span class="text-xl text-retro-orange font-black">📅</span>
            <h2 class="text-2xl font-extrabold uppercase text-retro-ink tracking-wide">
              Master Time Selector
            </h2>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            ${presets.map(p => `
              <button data-preset="${p.id}" class="preset-btn font-heading text-sm uppercase px-3 py-1.5 retro-border transition-all ${
                currentPreset === p.id 
                  ? 'bg-retro-orange text-retro-paper retro-shadow-sm translate-x-0.5 translate-y-0.5 font-bold'
                  : 'bg-retro-paper text-retro-ink hover:bg-retro-sky'
              }">
                ${p.label}
              </button>
            `).join('')}
          </div>
        </div>

        ${currentPreset === 'custom' ? `
          <div class="mt-4 pt-3 border-t border-stone-400 flex flex-wrap items-center gap-4 text-xs font-mono">
            <label class="flex items-center gap-2">
              <span class="font-bold uppercase text-retro-ink">From:</span>
              <input type="date" id="custom-start" value="${AppState.customStart || ''}" class="bg-retro-paper retro-border p-1.5 text-retro-ink focus:outline-none" />
            </label>
            <label class="flex items-center gap-2">
              <span class="font-bold uppercase text-retro-ink">To:</span>
              <input type="date" id="custom-end" value="${AppState.customEnd || ''}" class="bg-retro-paper retro-border p-1.5 text-retro-ink focus:outline-none" />
            </label>
            <button id="apply-custom" class="bg-retro-teal text-retro-paper px-3 py-1 retro-border retro-shadow-sm font-bold uppercase hover:bg-retro-teal-light">
              Apply Filter
            </button>
          </div>
        ` : ''}
      </section>
    `;

    this.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const preset = (e.currentTarget as HTMLElement).dataset.preset as DatePreset;
        AppState.setDatePreset(preset);
      });
    });

    const applyBtn = this.querySelector('#apply-custom');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        const startInput = (this.querySelector('#custom-start') as HTMLInputElement)?.value;
        const endInput = (this.querySelector('#custom-end') as HTMLInputElement)?.value;
        AppState.setDatePreset('custom', startInput || null, endInput || null);
      });
    }
  }
}

customElements.define('master-time-selector', MasterTimeSelector);
