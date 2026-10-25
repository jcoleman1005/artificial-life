import { defineConfig } from 'vite';

// ALIFE_SERVER=http://localhost:8080 npm run dev: the dev page watches that
// always-on server's world instead of running its own.
const alifeServer = process.env.ALIFE_SERVER;

export default defineConfig({
  server: {
    host: '0.0.0.0',
    ...(alifeServer ? { proxy: { '/api': { target: alifeServer, changeOrigin: true } } } : {}),
  },
});
