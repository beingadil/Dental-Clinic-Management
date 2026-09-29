/// <reference types="vite/client" />

/** Injected by vite.config.ts `define` from package.json version. */
declare const __APP_VERSION__: string;

// sql.js ships JS without resolvable types under bundler moduleResolution;
// the engine wrapper (src/db/engine.ts) provides the typed surface we use.
declare module 'sql.js';

declare module '*?url' {
  const src: string;
  export default src;
}
