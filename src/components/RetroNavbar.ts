import { AppState } from '../state/AppState';

export class RetroNavbar extends HTMLElement {
  connectedCallback() {
    this.render();
    AppState.addEventListener('app-state-changed', () => this.render());
  }

  render() {
    const status = AppState.dataStatus;
    const hasData = status.hasTimeline || status.hasSavedPlaces || status.hasMyMaps;

    this.innerHTML = `
      <header class="bg-retro-ochre text-retro-paper retro-border-lg retro-shadow-lg p-4 mb-6 relative overflow-hidden">
        <div class="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <!-- Logo & Vintage Badge -->
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-full bg-retro-orange border-2 border-retro-paper flex items-center justify-center retro-shadow-sm">
              <span class="text-2xl font-black">✈</span>
            </div>
            <div>
              <h1 class="text-3xl sm:text-4xl font-extrabold tracking-wider uppercase text-retro-paper drop-shadow-[2px_2px_0px_#1C1917]">
                MyTimeline <span class="text-retro-sky text-2xl font-normal">Retro Express</span>
              </h1>
              <p class="text-xs uppercase font-mono tracking-widest text-retro-paper opacity-90">
                Google Takeout Travel Archive & Analytics
              </p>
            </div>
          </div>

          <!-- Dataset Status Indicators & Action Buttons -->
          <div class="flex flex-wrap items-center gap-3">
            <div class="flex items-center gap-2 bg-retro-paper text-retro-ink px-3 py-1.5 retro-border retro-shadow-sm text-xs font-mono">
              <span class="font-bold uppercase">Status:</span>
              ${hasData ? `
                <span class="inline-flex items-center gap-1 text-retro-teal font-bold">
                  <span class="w-2 h-2 rounded-full bg-retro-teal animate-pulse"></span> Data Loaded
                </span>
              ` : `
                <span class="inline-flex items-center gap-1 text-retro-orange font-bold">
                  <span class="w-2 h-2 rounded-full bg-retro-orange"></span> No Data
                </span>
              `}
            </div>

            ${status.hasTimeline ? `<span class="bg-retro-teal text-retro-paper text-xs font-bold px-2.5 py-1 retro-border">Timeline</span>` : ''}
            ${status.hasSavedPlaces ? `<span class="bg-retro-orange text-retro-paper text-xs font-bold px-2.5 py-1 retro-border">Places</span>` : ''}
            ${status.hasMyMaps ? `<span class="bg-retro-sky text-retro-ink text-xs font-bold px-2.5 py-1 retro-border">My Maps</span>` : ''}

            <button id="upload-btn" class="bg-retro-orange hover:bg-retro-orange-bright text-retro-paper font-display text-lg px-4 py-1.5 retro-border retro-shadow hover:translate-x-0.5 hover:translate-y-0.5 transition-all">
              + Upload Takeout
            </button>
          </div>
        </div>
      </header>
    `;

    this.querySelector('#upload-btn')?.addEventListener('click', () => {
      AppState.toggleUploadModal(true);
    });
  }
}

customElements.define('retro-navbar', RetroNavbar);
