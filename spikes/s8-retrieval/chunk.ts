/**
 * Heading-aware chunking. A chunk never crosses a heading, keeps tables and lists whole when they
 * fit, and carries its heading trail so a passage makes sense on its own. Sizes are in estimated
 * tokens (characters / 4), which is enough to stay far under the embedding model's input limit.
 */
import { createHash } from 'node:crypto';

export interface Chunk {
  readonly ordinal: number;
  readonly section: string | undefined;
  readonly text: string;
  /** Hash of what gets embedded (title + section + text): the embedding cache key. */
  readonly sha256: string;
}

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export function chunkDocument(title: string, text: string, maxTokens = 350): Chunk[] {
  const sections: { trail: string[]; blocks: string[] }[] = [];
  const trail: string[] = [];
  let current: { trail: string[]; blocks: string[] } = { trail: [], blocks: [] };
  sections.push(current);
  for (const block of text.split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed.split('\n')[0] ?? '');
    if (heading?.[1] && heading[2]) {
      const level = heading[1].length;
      trail.length = level - 1;
      trail[level - 1] = heading[2].trim();
      current = { trail: trail.filter(Boolean), blocks: [] };
      sections.push(current);
      const rest = trimmed.split('\n').slice(1).join('\n').trim();
      if (rest) current.blocks.push(rest);
      continue;
    }
    current.blocks.push(trimmed);
  }

  const chunks: Chunk[] = [];
  for (const section of sections) {
    let buffer: string[] = [];
    const flush = () => {
      if (buffer.length === 0) return;
      const body = buffer.join('\n\n');
      const sectionLabel = section.trail.length > 0 ? section.trail.join(' › ') : undefined;
      chunks.push({
        ordinal: chunks.length,
        section: sectionLabel,
        text: body,
        sha256: createHash('sha256')
          .update(`${title}\n${sectionLabel ?? ''}\n${body}`)
          .digest('hex'),
      });
      buffer = [];
    };
    for (const block of section.blocks) {
      if (buffer.length > 0 && estimateTokens([...buffer, block].join('\n\n')) > maxTokens) flush();
      // A single block over the limit is split by lines (long tables, long lists).
      if (estimateTokens(block) > maxTokens) {
        let lines: string[] = [];
        for (const line of block.split('\n')) {
          if (lines.length > 0 && estimateTokens([...lines, line].join('\n')) > maxTokens) {
            buffer.push(lines.join('\n'));
            flush();
            lines = [];
          }
          lines.push(line);
        }
        if (lines.length > 0) buffer.push(lines.join('\n'));
        continue;
      }
      buffer.push(block);
    }
    flush();
  }
  return chunks;
}

/** What gets embedded and what the model reads: the chunk with its document and section. */
export function embeddingInput(title: string, chunk: Pick<Chunk, 'section' | 'text'>): string {
  return `${title}${chunk.section ? ` — ${chunk.section}` : ''}\n\n${chunk.text}`;
}
