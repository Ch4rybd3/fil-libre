import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  optimizeDeps: { include: ['clipper-lib', 'opentype.js'] },
  server: { port: 5180 },
});
