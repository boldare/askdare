/**
 * Which models does the test project allow, and do they accept `context_management`?
 * One tiny stateless request per candidate (a few dozen tokens). Never prints the key.
 *
 *   node --env-file-if-exists=../../examples/starter/.env.local --env-file-if-exists=../../.env.smoke.local probe.ts
 */
import OpenAI, { APIError } from 'openai';

// Cheapest first (https://developers.openai.com/api/docs/pricing, 2026-11-12).
const CANDIDATES = ['gpt-6-luna', 'gpt-6.1-terra'];
const client = new OpenAI({ maxRetries: 0, timeout: 60_000 });

for (const model of CANDIDATES) {
  try {
    const response = await client.responses.create({
      model,
      store: false,
      max_output_tokens: 64,
      input: 'Say "hi".',
      context_management: [{ type: 'compaction', compact_threshold: 50_000 }],
    });
    console.log(model, { status: response.status, usage: response.usage?.total_tokens });
  } catch (error) {
    console.log(model, error instanceof APIError ? { status: error.status, code: error.code, message: error.message } : String(error));
  }
}
