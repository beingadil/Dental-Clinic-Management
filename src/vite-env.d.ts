/// <reference types="vite/client" />

// sql.js ships JS without resolvable types under bundler moduleResolution;
// the engine wrapper (src/db/engine.ts) provides the typed surface we use.
declare module 'sql.js';

declare module '*?url' {
  const src: string;
  export default src;
}
