// Minimal stand-in for the OpenAI API used by end-to-end tests. The starter reaches it through
// OPENAI_BASE_URL, so no real API call (or key) is ever involved.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_OPENAI_PORT ?? 4010);
let nextConversation = 1;

const readJson = async (request) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
};

const json = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function streamResponse(response, text) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  let sequence = 0;
  const send = (event) =>
    response.write(
      `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number: sequence++ })}\n\n`,
    );
  send({ type: 'response.created', response: { id: 'resp_mock', status: 'in_progress' } });
  for (const word of text.split(/(?<= )/)) {
    await sleep(20);
    send({
      type: 'response.output_text.delta',
      item_id: 'msg',
      output_index: 0,
      content_index: 0,
      delta: word,
      logprobs: [],
    });
  }
  send({
    type: 'response.completed',
    response: {
      id: 'resp_mock',
      status: 'completed',
      incomplete_details: null,
      output: [],
      usage: {
        input_tokens: 10,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens: 5,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 15,
      },
    },
  });
  response.end();
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', `http://localhost:${PORT}`);
  if (pathname === '/health') return json(response, 200, { ok: true });
  if (request.method === 'POST' && pathname === '/v1/conversations') {
    return json(response, 200, {
      id: `conv_${nextConversation++}`,
      object: 'conversation',
      created_at: 0,
      metadata: {},
    });
  }
  if (request.method === 'POST' && pathname === '/v1/responses') {
    const body = await readJson(request);
    const userText = body.input?.[0]?.content ?? '';
    return streamResponse(response, `You said: ${userText} (in ${body.conversation})`);
  }
  if (request.method === 'DELETE' && pathname.startsWith('/v1/conversations/')) {
    return json(response, 200, {
      id: pathname.split('/').at(-1),
      deleted: true,
      object: 'conversation.deleted',
    });
  }
  json(response, 404, {
    error: { message: `Mock has no route for ${request.method} ${pathname}` },
  });
}).listen(PORT, '127.0.0.1', () => console.log(`mock OpenAI on http://127.0.0.1:${PORT}`));
