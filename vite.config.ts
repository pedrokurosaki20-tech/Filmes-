import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/api-torbox': {
          target: 'https://api.torbox.app',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-torbox/, ''),
        },
        '/api-yts': {
          target: 'https://movies-api.accel.li',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-yts/, ''),
        },
        '/api-apibay': {
          target: 'https://apibay.org',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-apibay/, ''),
        },
        '/api-torrentio': {
          target: 'https://torrentio.strem.fun',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-torrentio/, ''),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          },
        },
        '/api-brazuca': {
          target: 'https://94c8cb9f702d-brazuca-torrents.baby-beamup.club',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-brazuca/, ''),
        },
        '/api-plenoflu': {
          target: 'https://plenoflu.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-plenoflu/, ''),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Referer': 'https://plenoflu.com/',
            'Origin': 'https://plenoflu.com',
          },
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Referer', 'https://plenoflu.com/');
              proxyReq.setHeader('Origin', 'https://plenoflu.com');
              proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
            });
            proxy.on('proxyRes', (proxyRes) => {
              delete proxyRes.headers['x-frame-options'];
              delete proxyRes.headers['content-security-policy'];
              delete proxyRes.headers['content-security-policy-report-only'];
            });
          },
        },
      },
    },
  };
});


