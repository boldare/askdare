/**
 * Follow-up to the main S5b run: with `conversation`, input did not shrink after compaction.
 * How small is the compacted state when the caller sends it explicitly, as the compaction guide
 * describes for stateless chaining ("drop items that came before the most recent compaction item")?
 *
 * 1. Build a conversation past 50k tokens on the cheapest model, with compaction on.
 * 2. Next turn with `conversation` (what askdare does): usage.input_tokens.
 * 3. The same next turn stateless (store: false, no conversation), with input = the latest
 *    compaction item + the items after it + the new message: usage.input_tokens and recall.
 *
 *   node --env-file-if-exists=../../examples/starter/.env.local --env-file-if-exists=../../.env.smoke.local probe-stateless.ts
 */
import { writeFile } from 'node:fs/promises';
import OpenAI from 'openai';
import type { ResponseInputItem } from 'openai/resources/responses/responses';

const client = new OpenAI({ maxRetries: 1, timeout: 300_000 });
const model = 'gpt-6-luna';
const THRESHOLD = 50_000;
const base = {
  model,
  instructions: 'You are the support assistant of a home-goods shop. Be brief.',
  max_output_tokens: 16_384,
  truncation: 'auto' as const,
  context_management: [{ type: 'compaction', compact_threshold: THRESHOLD }],
};

const NAMES = ['Amelia', 'Bartek', 'Chiara', 'Dawid', 'Elif', 'Farid', 'Greta', 'Hugo'];
const CITIES = ['Lisbon', 'Gdansk', 'Porto', 'Lyon', 'Bergen', 'Krakow', 'Turin', 'Ghent'];
function tickets(block: number, lines: number): string {
  const out: string[] = [];
  for (let i = 1; i <= lines; i += 1) {
    const n = block * 7919 + i * 104_729;
    if (block === 1 && i === 120) out.push('Ticket 1-120 (internal): the Bergen warehouse gate code is 7319.');
    else out.push(`Ticket ${block}-${i}: ${NAMES[n % 8]} reported that order #${(n % 90_000) + 10_000} of ${(n % 37) + 2} items to ${CITIES[(n >> 3) % 8]} arrived late; agent ${NAMES[(n >> 5) % 8]} offered a ${(n % 4) * 5 + 5}% voucher.`);
  }
  return out.join('\n');
}

const report: Record<string, unknown> = { model, threshold: THRESHOLD };
const conversation = await client.conversations.create({ metadata: { askdare_bot: 'spike-s5b', askdare_visitor: 'stateless-probe' } });
const usages: Record<string, unknown>[] = [];
let spentTokens = { input: 0, output: 0 };
const track = (label: string, usage: OpenAI.Responses.ResponseUsage | undefined, output: { type: string }[], text: string): void => {
  if (usage) spentTokens = { input: spentTokens.input + usage.input_tokens, output: spentTokens.output + usage.output_tokens };
  usages.push({ label, input: usage?.input_tokens, cached: usage?.input_tokens_details.cached_tokens, output: usage?.output_tokens, outputTypes: output.map((item) => item.type), text: text.slice(0, 100) });
  console.log(label, usage?.input_tokens, usage?.output_tokens, output.map((item) => item.type).join(','));
};
try {
  const first = await client.responses.create({ ...base, conversation: conversation.id, store: true, input: 'Hi, I am Ola. My code word is PAPAYA-42. Reply "noted".' });
  track('t1', first.usage, first.output, first.output_text);
  let compacted = false;
  for (let block = 1; block <= 6 && !compacted; block += 1) {
    const response = await client.responses.create({
      ...base, conversation: conversation.id, store: true,
      input: `Support tickets:\n${tickets(block, 330)}\nReply with the single word "noted".`,
    });
    track(`filler-${block}`, response.usage, response.output, response.output_text);
    compacted = response.output.some((item) => item.type === 'compaction');
  }
  const question = 'What is my name, my code word, and the Bergen warehouse gate code? One line.';

  // The way askdare sends a turn.
  const viaConversation = await client.responses.create({ ...base, conversation: conversation.id, store: true, input: question });
  track('next-turn-via-conversation', viaConversation.usage, viaConversation.output, viaConversation.output_text);

  // The stateless way: the latest compaction item and what follows it.
  const items = await client.conversations.items.list(conversation.id, { order: 'asc', limit: 100 });
  report['itemsInConversation'] = items.data.map((item) => item.type === 'message' ? `message:${item.role}` : item.type);
  const lastCompaction = items.data.findLastIndex((item) => item.type === 'compaction');
  // Up to the compaction that the previous filler turn produced (the turn above added more).
  const beforeQuestion = items.data.slice(0, items.data.findLastIndex((item) => item.type === 'message' && item.role === 'user'));
  const cut = beforeQuestion.findLastIndex((item) => item.type === 'compaction');
  report['lastCompactionIndex'] = lastCompaction;
  const window: ResponseInputItem[] = beforeQuestion.slice(cut).flatMap((item): ResponseInputItem[] => {
    if (item.type === 'compaction') return [{ type: 'compaction', id: item.id, encrypted_content: item.encrypted_content }];
    if (item.type === 'message' && (item.role === 'user' || item.role === 'assistant')) {
      const text = item.content.map((part) => ('text' in part ? part.text : '')).join('');
      return [{ role: item.role, content: text }];
    }
    return [];
  });
  report['statelessWindowTypes'] = window.map((item) => ('type' in item && item.type ? item.type : `message:${'role' in item ? item.role : '?'}`));
  const counted = await client.responses.inputTokens.count({ model, instructions: base.instructions, input: [...window, { role: 'user', content: question }] });
  report['statelessCountedInput'] = counted.input_tokens;
  const stateless = await client.responses.create({ ...base, store: false, input: [...window, { role: 'user', content: question }] });
  track('next-turn-stateless-from-compaction', stateless.usage, stateless.output, stateless.output_text);
  report['statelessRecall'] = {
    name: /ola/i.test(stateless.output_text),
    codeWord: stateless.output_text.includes('PAPAYA-42'),
    gateCode: stateless.output_text.includes('7319'),
  };
  report['conversationRecall'] = {
    name: /ola/i.test(viaConversation.output_text),
    codeWord: viaConversation.output_text.includes('PAPAYA-42'),
    gateCode: viaConversation.output_text.includes('7319'),
  };
} finally {
  report['usages'] = usages;
  report['tokens'] = spentTokens;
  report['worstCaseUsd'] = Number(((spentTokens.input * 0.125 + spentTokens.output * 0.5) / 1_000_000).toFixed(4));
  report['deleted'] = await client.conversations.delete(conversation.id).then(() => true, (e: unknown) => String(e));
  await writeFile(new URL('./results-stateless.json', import.meta.url), `${JSON.stringify(report, null, 2).replaceAll(/"(encrypted_content)":\s*"[^"]*"/g, '"$1":"redacted"')}\n`);
  console.log(JSON.stringify({ ...report, usages: undefined }, null, 2));
}
