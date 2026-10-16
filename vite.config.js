import { defineConfig } from 'vite';

// 相対パスにしておくと GitHub Pages（/niigata_map_001/）でもローカルでも同じ設定で動く
export default defineConfig({
  base: './',
  build: { outDir: 'dist', sourcemap: false },
});
