import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      includeAssets: [
        'icons/icon.svg',
        'icons/icon-192.png',
        'icons/icon-512.png'
      ],
      manifest: {
        id: '/',
        name: 'Ulala',
        short_name: 'Ulala',
        description: 'Itinerario compartido y claro para viajar sin estrés.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#f7f6f2',
        theme_color: '#f7f6f2',
        lang: 'es',
        categories: ['travel', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
      }
    })
  ],
  test: {
    environment: 'node',
    globals: true
  }
})
