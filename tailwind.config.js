/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,html}",
  ],
  theme: {
    extend: {
      colors: {
        retro: {
          ochre: '#D97706',
          'ochre-light': '#F59E0B',
          orange: '#C2410C',
          'orange-bright': '#EA580C',
          teal: '#0D9488',
          'teal-light': '#14B8A6',
          sky: '#BAE6FD',
          'sky-light': '#E0F2FE',
          paper: '#FBF7EE',
          'paper-card': '#FFFDF9',
          border: '#44403C',
          ink: '#1C1917',
          muted: '#78716C',
        },
      },
      fontFamily: {
        display: ['Bebas Neue', 'Montserrat', 'Impact', 'sans-serif'],
        heading: ['Montserrat', 'Futura', 'sans-serif'],
        body: ['Outfit', 'system-ui', 'sans-serif'],
        mono: ['Courier Prime', 'monospace'],
      },
      boxShadow: {
        'retro': '4px 4px 0px 0px #1C1917',
        'retro-sm': '2px 2px 0px 0px #1C1917',
        'retro-lg': '6px 6px 0px 0px #1C1917',
      },
    },
  },
  plugins: [],
};
