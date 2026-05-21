import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Makes all paths relative so it deploys flawlessly on GitHub Pages
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  }
});
