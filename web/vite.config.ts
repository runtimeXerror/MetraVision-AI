import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * Vite configuration.
 *
 * The dev server proxies `/api` to the backend so the browser sees a
 * same-origin API during development. That keeps cookies, CORS and the
 * `VITE_API_URL` default simple: point a build at a real host by setting
 * `VITE_API_URL`, and leave it unset locally.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backend = env.VITE_PROXY_TARGET || 'http://localhost:4000';

  return {
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(__dirname, './src') },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: backend, changeOrigin: true },
        // Uploaded evidence images are served by the backend from /uploads.
        '/uploads': { target: backend, changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          // Recharts and the query client are large and change rarely; keeping
          // them out of the app chunk means a code edit doesn't invalidate them.
          manualChunks: {
            charts: ['recharts'],
            vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
          },
        },
      },
    },
  };
});
