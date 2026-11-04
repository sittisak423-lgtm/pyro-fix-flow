import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages เสิร์ฟที่ https://<user>.github.io/<repo>/ → ใช้ base แบบ relative ('./') ใช้ได้ทุกชื่อ repo
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1200 },
  server: { port: 5173 },
});
