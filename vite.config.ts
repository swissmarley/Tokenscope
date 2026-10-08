/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // GitHub Pages serves from /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  server: {
    // IPv4 loopback explicitly: "localhost" can resolve to ::1 only, leaving 127.0.0.1:5173 refused.
    host: '127.0.0.1',
    port: Number(process.env.PORT) || 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  preview: { host: '127.0.0.1' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
