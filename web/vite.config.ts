import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  build: {target: ['es2018', 'safari14']},
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    manifest: {
      name: '拼豆画板', short_name: '拼豆画板', lang: 'zh-CN',
      start_url: '/', scope: '/', display: 'standalone',
      theme_color: '#16705b', background_color: '#f4f6f5',
      icons: [{src:'/icons/icon-192.png',sizes:'192x192',type:'image/png'},
        {src:'/icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'}],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,png}'],
      navigateFallbackDenylist: [/^\/api\//],
      runtimeCaching: [{ urlPattern: /\/api\//, handler: 'NetworkOnly' }],
    },
  })],
  server: { proxy: { '/api': {target: process.env.PINDOU_API_TARGET ?? 'http://127.0.0.1:8080', changeOrigin: false} } },
  test: {include: ['tests/**/*.test.ts']},
});
