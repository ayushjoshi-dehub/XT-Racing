import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';
import { sites } from './build/sites-vite-plugin.js';

export default defineConfig({
  plugins: [
    sites(),
    cloudflare({
      viteEnvironment: { name: 'server' },
      config: {
        name: 'road-rash-2026-pacific-run',
        main: './worker/index.js',
        compatibility_date: '2026-07-10',
        compatibility_flags: ['nodejs_compat'],
        assets: {
          binding: 'ASSETS',
          not_found_handling: 'single-page-application',
        },
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
});
