import { defineConfig, type Plugin } from 'vite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// The editable changelog lives in dist; preserve it across Vite's output cleanup.
function editableChangelog(): Plugin {
  let filename: string;
  let building = false;
  let contents: Buffer | undefined;
  return {
    name: 'editable-dist-changelog',
    configResolved(config) { filename = resolve(config.root, 'dist/changelog.json'); building = config.command === 'build'; },
    buildStart() {
      if (!building) return;
      contents = existsSync(filename) ? readFileSync(filename) : Buffer.from('[]\n');
      JSON.parse(contents.toString('utf8')); // Fail before output cleanup if an edit is invalid.
      this.emitFile({ type: 'asset', fileName: 'changelog.json', source: contents });
    },
    closeBundle() {
      // Also restore the source if rendering fails after the output folder is cleared.
      if (contents && !existsSync(filename)) {
        mkdirSync(dirname(filename), { recursive: true });
        writeFileSync(filename, contents);
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/changelog.json') return next();
        try {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(existsSync(filename) ? readFileSync(filename) : '[]');
        } catch (error) { next(error); }
      });
    }
  };
}

export default defineConfig({
  plugins: [editableChangelog()],
  optimizeDeps: { include: ['node-unrar-js/esm/index.esm.js'] },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true }
});
