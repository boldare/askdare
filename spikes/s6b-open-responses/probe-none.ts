/** Follow-up: Claude via OpenRouter with tool_choice 'none' on the first step (raw events, 3 runs). */
import OpenAI from 'openai';
import { INSTRUCTIONS, responseTools } from './turn.ts';

const client = new OpenAI({ apiKey: process.env['OPENROUTER_API_KEY'], baseURL: 'https://openrouter.ai/api/v1', maxRetries: 1 });
const out: unknown[] = [];
for (const variant of ['none', 'none-no-tools-note', 'auto-no-tools']) {
  const tools = variant === 'auto-no-tools' ? [] : responseTools({ suggest: true, maxSteps: 1, maxOutputTokens: 1024 });
  const r = await client.responses.create({
    model: 'anthropic/claude-haiku-5.5',
    instructions:
      variant === 'none-no-tools-note'
        ? `${INSTRUCTIONS}\n\nTools are unavailable for this answer: answer in text now.`
        : INSTRUCTIONS,
    input: [{ role: 'user', content: 'What time is it now in Warsaw?' }],
    store: false,
    max_output_tokens: 1024,
    ...(tools.length ? { tools, tool_choice: 'none' as const } : {}),
  });
  const u = r.usage as (typeof r.usage & { cost?: number }) | undefined;
  out.push({
    variant,
    status: r.status,
    incomplete: r.incomplete_details,
    output: r.output.map((o) => (o.type === 'message' ? { type: o.type, text: o.content.map((c) => ('text' in c ? c.text : c.type)).join('') } : { type: o.type })),
    outputTokens: u?.output_tokens,
    cost: u?.cost,
  });
}
console.log(JSON.stringify(out, null, 1));
