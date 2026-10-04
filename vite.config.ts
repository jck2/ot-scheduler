import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'child_process';
import path from 'path';

// Build-time version info. The commit count gives a human-friendly build number
// that increments on every push (requires full git history in CI — see
// fetch-depth: 0 in deploy.yml). Falls back gracefully when git is unavailable.
function git(cmd: string, fallback: string): string {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return fallback;
  }
}
const appVersion = git('git rev-list --count HEAD', '0');
const gitSha = git('git rev-parse --short HEAD', 'dev');
const buildDate = new Date().toISOString().slice(0, 10);

export default defineConfig({
  base: '/ot-scheduler/',
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __GIT_SHA__: JSON.stringify(gitSha),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'OT Schedule Builder',
        short_name: 'OT Scheduler',
        description: 'Occupational Therapy scheduling tool',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
