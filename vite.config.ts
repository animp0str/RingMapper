import { defineConfig } from 'vite';
export default defineConfig({ optimizeDeps: { include: ['node-unrar-js/esm/index.esm.js'] }, server: { port: 5173, strictPort: true }, preview: { port: 4173, strictPort: true } });
