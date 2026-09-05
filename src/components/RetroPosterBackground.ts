export class RetroPosterBackground extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  render() {
    this.className = 'fixed inset-0 pointer-events-none -z-10 overflow-hidden select-none';
    this.innerHTML = `
      <!-- Full-Screen Drawn Retro Revival European Poster Background -->
      <div class="relative w-full h-full">
        <!-- Generated Vintage Poster Painting -->
        <img 
          src="/retro_bg.jpg" 
          alt="European Travel Poster Painting" 
          class="w-full h-full object-cover object-center opacity-35 filter saturate-[1.15] contrast-[1.05]"
        />

        <!-- Paper Texture Overlay -->
        <div class="absolute inset-0 bg-[#FBF7EE]/40 mix-blend-multiply"></div>
      </div>
    `;
  }
}

customElements.define('retro-poster-background', RetroPosterBackground);
