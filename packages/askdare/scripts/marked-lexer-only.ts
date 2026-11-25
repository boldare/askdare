// A tsdown (Rolldown) plugin for the React build: drops marked's default instance and the
// `marked()` function from the bundled copy of marked, so the Parser, Renderer and the rest of
// what only `marked()` uses can be tree-shaken. askdare uses `Lexer` alone (src/react/markdown.tsx)
// and renders tokens itself. marked declares no `sideEffects`, and its module creates
// `new Marked()` and fills properties of `marked` when it loads, so a bundler keeps all of it.
//
// The bundled file is minified, so the cut is found by shape: from `var <v>=new <Marked>;` (the
// default instance, the first statement after the classes) to the module's `export{…}`. What is
// removed only builds `marked()` and its shortcuts; none of it runs code or changes the state that
// `Lexer` reads. The export list keeps every name declared before the cut. If marked changes this
// shape, the build fails here instead of silently shipping all of marked again.
const MARKED = /[\\/]node_modules[\\/]marked[\\/]lib[\\/]marked\.esm\.js$/;

/** Rewrites marked's ESM build so that only its classes and defaults are left. */
export function lexerOnlyMarked(code: string): string {
  const exports = code.lastIndexOf('export{');
  const close = code.indexOf('};', exports);
  if (exports === -1 || close === -1) throw new Error('marked-lexer-only: no export list found');
  const names = new Map(
    code
      .slice(exports + 'export{'.length, close)
      .split(',')
      .map((entry) => {
        const [local = '', exported = local] = entry.trim().split(/\s+as\s+/);
        return [exported, local] as const;
      }),
  );
  const marked = names.get('Marked');
  const instance = marked
    ? new RegExp(`var [\\w$]+=new ${marked.replace(/\$/g, '\\$')};`).exec(code)
    : null;
  if (!instance) throw new Error('marked-lexer-only: no `new Marked()` instance found');
  const kept = code.slice(0, instance.index);
  const declared = (local: string): boolean =>
    new RegExp(
      `(?:var|let|const|function|class)\\s+${local.replace(/\$/g, '\\$')}\\b|[,{]${local.replace(/\$/g, '\\$')}=`,
    ).test(kept);
  const list = [...names].filter(([, local]) => declared(local));
  if (!list.some(([exported]) => exported === 'Lexer')) {
    throw new Error('marked-lexer-only: Lexer is not declared before the cut');
  }
  return `${kept}export{${list.map(([exported, local]) => `${local} as ${exported}`).join(',')}};`;
}

/** A Rolldown plugin with a filtered transform hook, as tsdown takes it. */
interface TransformPlugin {
  readonly name: string;
  readonly transform: {
    readonly filter: { readonly id: RegExp };
    handler(code: string): string;
  };
}

/** The plugin; tested with marked's real build in src/marked-lexer-only.test.ts. */
export const markedLexerOnly: TransformPlugin = {
  name: 'askdare:marked-lexer-only',
  transform: {
    filter: { id: MARKED },
    handler(code: string): string {
      return lexerOnlyMarked(code);
    },
  },
};
