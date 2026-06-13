import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://16.171.22.54',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'https://16.171.22.54',
        ws: true,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
