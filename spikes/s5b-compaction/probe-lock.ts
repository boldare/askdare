/**
 * Does `responses.inputTokens.count({ conversation })` lock the conversation, and for how long?
 * Found when the first S5b run got `conversation_locked` on every turn. A few hundred tokens.
 *
 *   node --env-file-if-exists=../../examples/starter/.env.local --env-file-if-exists=../../.env.smoke.local probe-lock.ts
 */
import OpenAI, { APIError } from 'openai';

const client = new OpenAI({ maxRetries: 0, timeout: 60_000 });
const model = 'gpt-6-luna';
const conversation = await client.conversations.create({ metadata: { askdare_bot: 'spike-s5b', askdare_visitor: 'lock-probe' } });
const report: Record<string, unknown> = {};
const tryTurn = async (): Promise<string> => {
  try {
    const response = await client.responses.create({
      model, conversation: conversation.id, store: true, max_output_tokens: 64, input: 'Say "ok".',
    });
    return response.status ?? 'unknown';
  } catch (error) {
    return error instanceof APIError ? `${error.status} ${error.code}` : String(error);
  }
};
try {
  report['turnBeforeAnyCount'] = await tryTurn();
  const count = await client.responses.inputTokens.count({ model, conversation: conversation.id, input: 'Say "ok".' });
  report['count'] = count.input_tokens;
  const started = performance.now();
  const attempts: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    const outcome = await tryTurn();
    attempts.push(`${Math.round((performance.now() - started) / 100) / 10}s: ${outcome}`);
    if (!outcome.includes('conversation_locked')) break;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  report['afterCount'] = attempts;
  // Does a second count right after a turn lock it again, and does a count after a count work?
  const c1 = await client.responses.inputTokens.count({ model, conversation: conversation.id, input: 'x' }).then((r) => r.input_tokens, (e: unknown) => String(e));
  const c2 = await client.responses.inputTokens.count({ model, conversation: conversation.id, input: 'x' }).then((r) => r.input_tokens, (e: unknown) => String(e));
  report['countThenCount'] = [c1, c2];
  // Stateless count of the same items (no conversation): does it lock anything?
  const items = await client.conversations.items.list(conversation.id, { order: 'asc', limit: 100 });
  report['itemsAfter'] = items.data.map((item) => item.type);
} finally {
  report['deleted'] = await client.conversations.delete(conversation.id).then(() => true, (e: unknown) => String(e));
  console.log(JSON.stringify(report, null, 2));
}
