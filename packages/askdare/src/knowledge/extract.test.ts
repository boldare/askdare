import { describe, expect, it } from 'vitest';
import { extractKnowledgeText, knowledgeFormat } from './extract';

describe('knowledgeFormat', () => {
  it('knows Markdown, MDX, plain text and HTML, and nothing else', () => {
    expect(knowledgeFormat('docs/a.md')).toBe('markdown');
    expect(knowledgeFormat('A.MARKDOWN')).toBe('markdown');
    expect(knowledgeFormat('a.mdx')).toBe('mdx');
    expect(knowledgeFormat('a.txt')).toBe('text');
    expect(knowledgeFormat('a.html')).toBe('html');
    expect(knowledgeFormat('a.htm')).toBe('html');
    expect(knowledgeFormat('a.pdf')).toBe(undefined);
    expect(knowledgeFormat('a.json')).toBe(undefined);
    expect(knowledgeFormat('dir.md/README')).toBe(undefined);
  });
});

describe('extractKnowledgeText', () => {
  it('reads Markdown front matter as kb sync does and removes it', () => {
    const result = extractKnowledgeText(
      'pricing.md',
      '﻿---\r\ntitle: "Pricing and plans"\r\nurl: https://example.test/pricing\r\nauthor: someone\r\n---\r\n# Plans\r\n\r\nTeam costs 12.\r\n',
    );
    expect(result).toEqual({
      title: 'Pricing and plans',
      url: 'https://example.test/pricing',
      text: '# Plans\n\nTeam costs 12.',
    });
  });

  it('keeps Markdown without front matter as it is', () => {
    expect(extractKnowledgeText('a.md', '# A\n\n---\n\nText.')).toEqual({
      title: undefined,
      url: undefined,
      text: '# A\n\n---\n\nText.',
    });
  });

  it('drops MDX imports, exports and comments', () => {
    const mdx = [
      "---\ntitle: 'Setup'\n---",
      "import { Callout } from '../components';",
      'export const meta = { draft: false };',
      '# Setup',
      '{/* internal note */}Install the package.',
      'Mention import of data here.',
    ].join('\n\n');
    expect(extractKnowledgeText('setup.mdx', mdx)).toEqual({
      title: 'Setup',
      url: undefined,
      text: '# Setup\n\nInstall the package.\n\nMention import of data here.',
    });
  });

  it('keeps plain text, normalizing line ends', () => {
    expect(extractKnowledgeText('notes.txt', 'Line one.\r\n\r\nLine two.\r\n')).toEqual({
      title: undefined,
      url: undefined,
      text: 'Line one.\n\nLine two.',
    });
  });

  it('turns HTML into text with headings and list items, and no markup', () => {
    const html = `<!doctype html><html><head><title>Ignored</title><style>p { color: red }</style></head>
      <body><h1>Status &amp; uptime</h1><!-- <p>hidden</p> -->
      <p>We aim for <b>99.9%</b>&nbsp;uptime.</p>
      <script>alert("x")</script>
      <ul><li>Email</li><li>Chat</li></ul>
      <table><tr><th>Plan</th><th>SLA</th></tr><tr><td>Team</td><td>99.9</td></tr></table>
      <p>Escaped &lt;script&gt; and &#60;b&#62; stay text; caf&#233; &quot;ok&quot;.</p></body></html>`;
    const result = extractKnowledgeText('status.html', html);
    expect(result?.title).toBe(undefined);
    expect(result?.text).toBe(
      [
        '# Status & uptime',
        'We aim for 99.9% uptime.',
        '- Email\n- Chat',
        '| Plan | SLA\n| Team | 99.9',
        'Escaped  script  and  b  stay text; café "ok".',
      ].join('\n\n'),
    );
    expect(result?.text).not.toMatch(/[<>]/);
  });

  it('drops the rest of an unclosed tag', () => {
    expect(
      extractKnowledgeText('a.htm', '<p>Visible</p><img src="x" onerror="alert(1)"')?.text,
    ).toBe('Visible');
  });

  it('returns undefined for formats the own index cannot read', () => {
    expect(extractKnowledgeText('guide.pdf', '%PDF-1.7')).toBe(undefined);
  });
});
