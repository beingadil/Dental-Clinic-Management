import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import pkg from './package.json';

export default defineConfig(() => {
  return {
    // Single source of truth for the app version: injected from package.json
    // at build time. A hardcoded duplicate previously drifted (stuck at
    // 2.10.0) and put already-updated installs into an endless update loop.
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // Production hardening: never ship source maps (they leak source) and keep
      // the minifier explicit so a config edit cannot silently disable it.
      sourcemap: false,
      minify: 'esbuild',
      rollupOptions: {
        output: {
          // Split heavyweight vendors out of the main bundle so the app shell
          // (and its cache fingerprint) stays small; libs are cached by the
          // browser/WebView across deploys since they change less often.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            // React core must stay together (react-dom depends on internals).
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-core';
            // Charting stack (recharts pulls the d3 family with it).
            if (/[\\/]node_modules[\\/](recharts|d3-[a-z-]+|victory-vendor|internmap|decimal\.js|eventemitter3)[\\/]/.test(id)) return 'charts';
            if (/[\\/]node_modules[\\/](motion|framer-motion)[\\/]/.test(id)) return 'motion';
            if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'icons';
            if (/[\\/]node_modules[\\/]sql\.js[\\/]/.test(id)) return 'db-engine';
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // Never watch the Rust build tree: on Windows, chokidar hits EBUSY trying
      // to watch .dll/.exe files that cargo is actively writing, which kills
      // the dev server mid `tauri dev`.
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/src-tauri/target/**'] },
    },
  };
});
