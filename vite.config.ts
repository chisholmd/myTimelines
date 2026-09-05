import { defineConfig } from 'vite';

export default defineConfig({
  base: '/myTimelines/',
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
