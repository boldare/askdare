// Offline check of the streaming marker rewriter: `node test-markers.ts`.
import assert from 'node:assert/strict';
import { MarkerRewriter, PassageRegistry } from './citations.ts';

const registry = new PassageRegistry();
const a = registry.add({ path: 'pricing.md', title: 'Pricing', url: 'https://example.com/pricing', section: 'Billing', text: 'x', score: 1 });
const b = registry.add({ path: 'security.md', title: 'Security', url: undefined, section: undefined, text: 'y', score: 1 });
assert.equal(registry.add({ path: 'pricing.md', title: 'Pricing', url: 'https://example.com/pricing', section: 'Billing', text: 'x', score: 0.5 }).sourceId, a.sourceId);

let out = '';
const events: unknown[] = [];
const rewriter = new MarkerRewriter(registry, (t) => (out += t), (e) => events.push(e));
for (const delta of ['Team costs €8 [', 'k', '1]. Data is in Frankfurt [k2', ', k1]. Ghost [k9]. Array [0] stays', ' and [unclosed']) {
  rewriter.push(delta);
}
rewriter.end();
assert.equal(out, 'Team costs €8 [1]. Data is in Frankfurt [2][1]. Ghost . Array [0] stays and [unclosed');
assert.deepEqual(events, [
  { type: 'citation', index: 1, title: 'Pricing', url: 'https://example.com/pricing' },
  { type: 'citation', index: 2, title: 'Security', url: undefined },
]);
assert.deepEqual(rewriter.invented, ['k9']);
assert.equal(b.sourceId, 'k2');
console.log('markers ok');
