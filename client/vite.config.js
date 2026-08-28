import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { host: true, port: 5173, proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/ws': { target: 'http://localhost:4000', ws: true, changeOrigin: true },
    } },
  preview: { port: 4173 },
});
