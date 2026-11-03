import { defineConfig } from 'vite';
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Every experiments/<slug>/index.html is its own page; no need to list them here.
const root = import.meta.dirname;
const pages = { hub: resolve(root, 'index.html') };
for (const slug of readdirSync(resolve(root, 'experiments'))) {
  const html = resolve(root, 'experiments', slug, 'index.html');
  if (existsSync(html)) pages[slug] = html;
}

export default defineConfig({
  base: './',
  server: { port: 5173 },
  // three.js alone is ~540 kB, shared by both car pages
  build: { rollupOptions: { input: pages }, chunkSizeWarningLimit: 700 },
});
