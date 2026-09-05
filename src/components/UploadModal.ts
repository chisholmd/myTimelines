import { AppState } from '../state/AppState';
import { parseUploadedFile } from '../services/ClientParser';
import { StorageService } from '../services/StorageService';

export class UploadModal extends HTMLElement {
  private isUploading = false;
  private uploadMessage = '';
  private isError = false;

  connectedCallback() {
    this.render();
    AppState.addEventListener('app-state-changed', () => this.render());
  }

  render() {
    const isOpen = AppState.isUploadModalOpen;
    if (!isOpen) {
      this.innerHTML = '';
      return;
    }

    this.innerHTML = `
      <div class="fixed inset-0 bg-stone-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div class="paper-texture retro-border-lg retro-shadow-lg max-w-xl w-full p-6 relative">
          <!-- Modal Header -->
          <div class="flex items-center justify-between border-b-2 border-stone-800 pb-3 mb-4">
            <div class="flex items-center gap-2">
              <span class="text-2xl text-retro-orange font-black">📦</span>
              <h3 class="text-2xl font-extrabold uppercase text-retro-ink tracking-wider">
                Upload Google Takeout Data
              </h3>
            </div>
            <button id="close-modal-btn" class="text-2xl font-black text-retro-ink hover:text-retro-orange px-2 border border-stone-800 bg-retro-paper cursor-pointer">
              ×
            </button>
          </div>

          <p class="text-xs font-mono text-stone-700 mb-4">
            Select or drag & drop your exported Google Takeout <span class="font-bold text-retro-orange">ZIP archive</span>, Timeline JSON, Saved Places JSON, or My Maps KMZ/KML files.
          </p>

          <!-- Dropzone Area -->
          <div id="dropzone" class="border-3 border-dashed border-stone-800 p-8 text-center bg-retro-paper hover:bg-amber-50 cursor-pointer retro-shadow-sm transition-all mb-4">
            <input type="file" id="file-input" class="hidden" accept=".zip,.json,.kmz,.kml" />
            <div class="text-4xl mb-2">📁</div>
            <p class="font-heading text-lg text-retro-ink font-bold uppercase mb-1">
              Click to browse or drop file here
            </p>
            <span class="text-xs font-mono text-stone-500">Supports .zip, .json, .kmz, .kml</span>
          </div>

          <!-- Upload Status Feedback -->
          ${this.uploadMessage ? `
            <div id="upload-status-banner" class="p-3 mb-4 retro-border text-xs font-mono font-bold ${
              this.isError ? 'bg-red-100 text-red-800 border-red-800' : 'bg-emerald-100 text-emerald-800 border-emerald-800'
            }">
              <span id="upload-status-msg">${this.uploadMessage}</span>
            </div>
          ` : ''}

          <!-- In-Browser Privacy & Local Processing Notice -->
          <div class="bg-retro-paper p-3 retro-border text-xs font-mono space-y-1.5 mb-4">
            <div class="flex items-center gap-1.5 font-bold text-retro-ink uppercase">
              <span>🔒</span> 100% In-Browser Processing (Zero Server Transmission)
            </div>
            <p class="text-[11px] text-stone-600 leading-relaxed">
              Your Google Takeout files are extracted, processed, and stored directly inside your browser's private database (<code class="bg-stone-200 px-1">IndexedDB</code>). Your personal location history never leaves your device and persists across page refreshes.
            </p>
            <div class="pt-1 flex flex-wrap gap-2 text-[10px] text-stone-700">
              <span class="bg-teal-50 border border-teal-600 px-1.5 py-0.5 font-bold">🛣️ Multi-Res LODs</span>
              <span class="bg-amber-50 border border-amber-600 px-1.5 py-0.5 font-bold">📍 Spatial Indexing</span>
              <span class="bg-purple-50 border border-purple-600 px-1.5 py-0.5 font-bold">🗺️ Vector KML/KMZ</span>
            </div>
          </div>

          <!-- Footer Actions -->
          <div class="flex items-center justify-between gap-2">
            <button id="clear-data-btn" class="text-xs font-mono font-bold text-rose-800 hover:text-rose-950 underline cursor-pointer">
              Clear Local Browser Data
            </button>
            <button id="cancel-btn" class="bg-retro-paper text-retro-ink px-4 py-2 retro-border text-sm font-heading uppercase hover:bg-stone-200 cursor-pointer">
              Close
            </button>
          </div>
        </div>
      </div>
    `;

    // Event Handlers
    this.querySelector('#close-modal-btn')?.addEventListener('click', () => AppState.toggleUploadModal(false));
    this.querySelector('#cancel-btn')?.addEventListener('click', () => AppState.toggleUploadModal(false));

    this.querySelector('#clear-data-btn')?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear all timeline data stored in your browser?')) {
        await AppState.clearStoredData();
        this.uploadMessage = 'Local browser database cleared.';
        this.isError = false;
        this.render();
      }
    });

    const dropzone = this.querySelector('#dropzone') as HTMLElement;
    const fileInput = this.querySelector('#file-input') as HTMLInputElement;

    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('bg-amber-100');
      });

      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('bg-amber-100');
      });

      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('bg-amber-100');
        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
          this.uploadFile(e.dataTransfer.files[0]);
        }
      });

      fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) {
          this.uploadFile(fileInput.files[0]);
        }
      });
    }
  }

  async uploadFile(file: File) {
    this.isUploading = true;
    this.uploadMessage = `Parsing and auto-detecting "${file.name}" in browser...`;
    this.isError = false;
    this.render();

    try {
      const existingData = {
        status: AppState.dataStatus,
        timeline: AppState.timeline,
        places: AppState.places,
        myMaps: AppState.myMaps,
      };

      const parsed = await parseUploadedFile(file, existingData, (msg, percent) => {
        this.uploadMessage = `[${percent}%] ${msg}`;
        const msgEl = this.querySelector('#upload-status-msg');
        if (msgEl) msgEl.textContent = this.uploadMessage;
      });

      // Save to IndexedDB
      this.uploadMessage = 'Saving datasets to local browser storage...';
      const msgEl = this.querySelector('#upload-status-msg');
      if (msgEl) msgEl.textContent = this.uploadMessage;

      await StorageService.saveDataset(parsed);

      // Update AppState
      await AppState.applyParsedDataset(parsed);

      this.isUploading = false;
      const vCount = parsed.timeline.visits.length;
      const pCount = parsed.places.savedPlaces.length;
      const mCount = parsed.myMaps.length;
      this.uploadMessage = `Success! Processed "${file.name}". Ready with ${vCount.toLocaleString()} visits, ${pCount.toLocaleString()} saved places, and ${mCount} maps!`;
      this.render();

      setTimeout(() => {
        AppState.toggleUploadModal(false);
        this.uploadMessage = '';
      }, 2200);
    } catch (err: any) {
      console.error('Error parsing file client-side:', err);
      this.isUploading = false;
      this.isError = true;
      this.uploadMessage = `Error parsing file: ${err.message}`;
      this.render();
    }
  }
}

customElements.define('upload-modal', UploadModal);
