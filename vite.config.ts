import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Same PORT the server uses (env > .env > 8080), so the proxy follows it.
  const port = process.env.PORT || loadEnv(mode, process.cwd(), '').PORT || '8080';
  return {
    root: 'web',
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { '/api': { target: `http://127.0.0.1:${port}`, changeOrigin: true } },
    },
    build: { outDir: '../dist/web', emptyOutDir: true },
  };
});
