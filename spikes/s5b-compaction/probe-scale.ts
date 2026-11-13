/**
 * Follow-up to the main S5b run and probe-stateless.ts: at a 50k threshold the compaction item
 * alone renders to about as many tokens as the history it replaced. Does that hold at higher
 * thresholds, or does the compacted state have a fixed size that only pays off higher up?
 *
 * For each threshold: grow a conversation (as askdare sends turns) with ~40k-token batches until
 * it compacts, then count the tokens of the latest compaction item on its own (stateless count,
 * no conversation, so nothing gets locked) and take the next turn's usage.input_tokens.
 *
 *   node --env-file-if-exists=../../examples/starter/.env.local --env-file-if-exists=../../.env.smoke.local probe-scale.ts
 */
import { writeFile } from 'node:fs/promises';
import OpenAI from 'openai';

const client = new OpenAI({ maxRetries: 1, timeout: 600_000 });
const model = process.env['S5B_MODEL'] ?? 'gpt-6-luna';
const THRESHOLDS = (process.env['S5B_THRESHOLDS'] ?? '100000,200000').split(',').map(Number);
// 1,050 lines is ~34.5k tokens of this generator's text; S5B_BLOCK_LINES=250 gives ~8k.
const BLOCK_LINES = Number(process.env['S5B_BLOCK_LINES'] ?? 1_050);
const TAG = process.env['S5B_TAG'] ?? 'luna';
const instructions = 'You are the support assistant of a home-goods shop. Be brief.';

const NAMES = ['Amelia', 'Bartek', 'Chiara', 'Dawid', 'Elif', 'Farid', 'Greta', 'Hugo'];
const CITIES = ['Lisbon', 'Gdansk', 'Porto', 'Lyon', 'Bergen', 'Krakow', 'Turin', 'Ghent'];
function tickets(block: number, lines: number): string {
  const out: string[] = [];
  for (let i = 1; i <= lines; i += 1) {
    const n = block * 7919 + i * 104_729;
    out.push(`Ticket ${block}-${i}: ${NAMES[n % 8]} reported that order #${(n % 90_000) + 10_000} of ${(n % 37) + 2} items to ${CITIES[(n >> 3) % 8]} arrived late; agent ${NAMES[(n >> 5) % 8]} offered a ${(n % 4) * 5 + 5}% voucher.`);
  }
  return out.join('\n');
}

const report: Record<string, unknown> = { model, blockLines: BLOCK_LINES };
const spent = { input: 0, cached: 0, output: 0 };
for (const threshold of THRESHOLDS) {
  const conversation = await client.conversations.create({ metadata: { askdare_bot: 'spike-s5b', askdare_visitor: `scale-${threshold}` } });
  const turns: Record<string, unknown>[] = [];
  // Fresh text per run so the prompt cache of an earlier run doesn't apply.
  const offset = TAG.length * 1000;
  const params = {
    model, instructions, conversation: conversation.id, store: true, truncation: 'auto' as const,
    max_output_tokens: 16_384, prompt_cache_key: `askdare:spike-s5b-scale-${TAG}-${threshold}`,
    context_management: [{ type: 'compaction', compact_threshold: threshold }],
  };
  try {
    const turn = async (label: string, input: string): Promise<OpenAI.Responses.Response> => {
      const started = performance.now();
      const response = await client.responses.create({ ...params, input });
      const usage = response.usage;
      if (usage) {
        spent.input += usage.input_tokens;
        spent.cached += usage.input_tokens_details.cached_tokens;
        spent.output += usage.output_tokens;
      }
      const compactions = response.output.filter((item) => item.type === 'compaction');
      turns.push({
        label, ms: Math.round(performance.now() - started), status: response.status,
        input: usage?.input_tokens, cached: usage?.input_tokens_details.cached_tokens, output: usage?.output_tokens,
        reasoning: usage?.output_tokens_details.reasoning_tokens,
        outputTypes: response.output.map((item) => item.type),
        encryptedChars: compactions.map((item) => item.encrypted_content.length),
      });
      console.log(threshold, label, usage?.input_tokens, usage?.output_tokens, response.status, response.output.map((item) => item.type).join(','));
      return response;
    };
    await turn('t1', 'Hi, I am Ola. My code word is PAPAYA-42. Reply "noted".');
    let last: OpenAI.Responses.Response | undefined;
    for (let block = 1; block <= 40; block += 1) {
      last = await turn(`filler-${block}`, `Support tickets:\n${tickets(block + offset, BLOCK_LINES)}\nReply with the single word "noted".`);
      if (last.output.some((item) => item.type === 'compaction')) break;
    }
    const compaction = last?.output.findLast((item) => item.type === 'compaction');
    if (compaction?.type === 'compaction') {
      const count = await client.responses.inputTokens.count({
        model, instructions, input: [{ type: 'compaction', id: compaction.id, encrypted_content: compaction.encrypted_content }],
      });
      report[`compactionItemTokens@${threshold}`] = count.input_tokens;
      console.log(threshold, 'latest compaction item alone renders to', count.input_tokens, 'tokens');
    }
    const next = await turn('next', 'What is my name and my code word? One line.');
    report[`recall@${threshold}`] = { name: /ola/i.test(next.output_text), codeWord: next.output_text.includes('PAPAYA-42') };
    await turn('next-2', 'Say "ok".');
  } catch (error) {
    report[`error@${threshold}`] = error instanceof Error ? error.message : String(error);
  } finally {
    report[`turns@${threshold}`] = turns;
    report[`deleted@${threshold}`] = await client.conversations.delete(conversation.id).then(() => true, (e: unknown) => String(e));
  }
}
report['tokens'] = spent;
// Per 1M (https://developers.openai.com/api/docs/pricing); worst case: every uncached input token is a cache write.
const price = model === 'gpt-6.1-terra' ? { write: 1.25, cached: 0.05, output: 5 } : { write: 0.125, cached: 0.01, output: 0.5 };
report['worstCaseUsd'] = Number((((spent.input - spent.cached) * price.write + spent.cached * price.cached + spent.output * price.output) / 1_000_000).toFixed(4));
await writeFile(new URL(`./results-scale-${TAG}.json`, import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ tokens: report['tokens'], worstCaseUsd: report['worstCaseUsd'] }));
