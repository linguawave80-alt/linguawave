import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 3000, host: true },
  test: { environment: 'jsdom', include: ['src/**/*.test.{js,jsx}'] },
  preview: { port: 3000, host: true, allowedHosts: true },
});
