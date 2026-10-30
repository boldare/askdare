import type { CSSProperties } from 'react';

const PRESETS = ['halo', 'aura', 'sage', 'care'] as const;
const SCHEMES = ['light', 'dark'] as const;
const STATES = ['welcome', 'conversation', 'streaming', 'attachments', 'error', 'listening'];
const WIDTHS = { panel: 400, mobile: 360 } as const;

type Search = Promise<Record<string, string | string[] | undefined>>;

const pick = <T extends string>(value: unknown, options: readonly T[]): T =>
  options.includes(value as T) ? (value as T) : (options[0] as T);

const link = (active: boolean): CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 999,
  textDecoration: 'none',
  color: active ? '#fff' : '#1f2937',
  background: active ? '#111827' : '#e5e7eb',
  fontSize: 14,
});

/**
 * Every state of the widget in one preset, scheme and width: for design review, and the source
 * of the visual tests. Needs ASKDARE_GALLERY=1, which the chat route uses to allow fixtures.
 */
export default async function Gallery({ searchParams }: { readonly searchParams: Search }) {
  const params = await searchParams;
  const preset = pick(params.preset, PRESETS);
  const scheme = pick(params.scheme, SCHEMES);
  const width = pick(params.width, ['panel', 'mobile'] as const);
  const href = (change: Record<string, string>) =>
    `/gallery?${new URLSearchParams({ preset, scheme, width, ...change })}`;
  const enabled = process.env.ASKDARE_GALLERY === '1';

  return (
    <main
      style={{
        padding: 24,
        background: scheme === 'dark' ? '#030712' : '#f3f4f6',
        minHeight: '100vh',
      }}
    >
      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
        {PRESETS.map((name) => (
          <a key={name} href={href({ preset: name })} style={link(name === preset)}>
            {name}
          </a>
        ))}
        <span style={{ width: 16 }} />
        {SCHEMES.map((name) => (
          <a key={name} href={href({ scheme: name })} style={link(name === scheme)}>
            {name}
          </a>
        ))}
        <span style={{ width: 16 }} />
        {(['panel', 'mobile'] as const).map((name) => (
          <a key={name} href={href({ width: name })} style={link(name === width)}>
            {name}
          </a>
        ))}
      </nav>
      {!enabled && <p>Start the app with ASKDARE_GALLERY=1 to render the gallery.</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
        {enabled &&
          STATES.map((state) => (
            <figure key={state} style={{ margin: 0 }}>
              <figcaption
                style={{
                  marginBottom: 8,
                  fontSize: 13,
                  color: scheme === 'dark' ? '#9ca3af' : '#4b5563',
                }}
              >
                {state}
              </figcaption>
              <iframe
                title={`${preset} ${scheme} ${state}`}
                data-state={state}
                src={`/api/chat/embed/support?${new URLSearchParams({ gallery: state, preset, scheme })}`}
                style={{
                  width: WIDTHS[width],
                  height: width === 'mobile' ? 720 : 640,
                  border: 0,
                  borderRadius: 16,
                  boxShadow: '0 24px 64px rgb(15 23 42 / 0.18)',
                  background: 'transparent',
                }}
              />
            </figure>
          ))}
      </div>
    </main>
  );
}
