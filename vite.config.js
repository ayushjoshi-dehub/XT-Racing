import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: 'all',
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: 'all',
  },
});
