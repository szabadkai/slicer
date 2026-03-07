import { defineConfig } from 'vite';

export default defineConfig({
  base: '/slicer/',
  root: '.',
  publicDir: 'public',
  server: {
    port: 3000,
    open: true,
  },
});
