/// <reference types="vite/client" />

// Injected at build time by vite.config.ts `define`.
declare const __APP_VERSION__: string; // incrementing build number (git commit count)
declare const __GIT_SHA__: string; // short commit hash
declare const __BUILD_DATE__: string; // YYYY-MM-DD of the build
