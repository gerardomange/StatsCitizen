import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: __dirname, plugins: [react()], css: { postcss: __dirname + '/../postcss.config.js' }, build: { outDir: __dirname + '/dist', emptyOutDir: true, assetsInlineLimit: 100000000, cssCodeSplit: false, modulePreload: false } });
