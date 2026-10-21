import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'logo.jpeg'],
      manifest: {
        name: 'Birs Prices | Tehran Cash Market',
        short_name: 'Birs Prices',
        description: 'Tehran Birs cash market buy and sell rates, charts, and history.',
        theme_color: '#0b1827',
        background_color: '#0b1827',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        lang: 'en',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        runtimeCaching: [{
          urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname === '/birs-price.php',
          handler: 'NetworkFirst',
          options: {
            cacheName: 'birs-price-history',
            networkTimeoutSeconds: 8,
            cacheableResponse: { statuses: [200] },
            expiration: { maxEntries: 40, maxAgeSeconds: 24 * 60 * 60 },
          },
        }],
      },
    }),
  ],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/birs-price.php': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
