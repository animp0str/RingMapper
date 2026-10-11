import { defineConfig } from 'vite';
import { mapApi } from './server/api';
export default defineConfig({ plugins: [mapApi()], server: { port: 5173, strictPort: true }, preview: { port: 4173, strictPort: true } });
