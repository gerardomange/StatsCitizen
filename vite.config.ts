import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Never let Vite's file watcher crawl Rust build output (src-tauri/target holds
      // hundreds of thousands of files) or other build/release folders: the initial crawl
      // starves Node's I/O pool and the app window stays blank for minutes.
      ignored: ['**/src-tauri/**', '**/release/**', '**/dist/**', '**/dist-electron/**', '**/.hud-preview/**'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Second entry: the OBS overlay page served by the local overlay server.
      input: {
        main: path.resolve(__dirname, 'index.html'),
        overlay: path.resolve(__dirname, 'overlay.html'),
      },
    },
  },
});
