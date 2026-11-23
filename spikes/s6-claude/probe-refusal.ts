// One-off: the stop_details of the refusals seen when the last step sends tool_choice none without a note.
import Anthropic from '@anthropic-ai/sdk';
import { runTurn, usd } from './claude-turn.ts';
const client = new Anthropic({ maxRetries: 1 });
let total = 0;
const out = [];
for (let i = 0; i < 3; i += 1) {
  const turn = await runTurn({
    client,
    bot: { suggest: true, knowledge: false, keepLengths: false, maxSteps: 5, effort: 'low' },
    history: [],
    text: 'What time is it now in Warsaw, and how much is 100 EUR in PLN?',
    userId: 'a3f1c9e07b5d42e8',
    messageId: 'm',
    emit: () => {},
    forceLastStep: true,
    maxTokens: 1200,
  });
  total += usd(turn.usage);
  const m = turn.steps[0]!.message;
  out.push({ stop: m.stop_reason, stop_details: (m as { stop_details?: unknown }).stop_details, blocks: m.content.map((b) => b.type), out: m.usage.output_tokens });
}
console.log(JSON.stringify({ out, usd: total.toFixed(4) }, null, 1));
