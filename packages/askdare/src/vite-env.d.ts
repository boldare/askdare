// Side-effect CSS imports in the iframe app are handled by Vite.
declare module '*.css';

// The stylesheet as text, for tests that read it.
declare module '*.css?raw' {
  const css: string;
  export default css;
}
