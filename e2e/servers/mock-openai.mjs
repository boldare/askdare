// Minimal stand-in for the OpenAI API used by end-to-end tests. The starter reaches it through
// OPENAI_BASE_URL, so no real API call (or key) is ever involved.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_OPENAI_PORT ?? 4010);
let nextConversation = 1;
/** Stored items per conversation, oldest first, as the Conversations API keeps them. */
const conversations = new Map();
let nextFile = 1;
/** Uploaded files that still exist, so tests can check they are deleted. */
const files = new Set();
/** Each streamed reply and whether the caller read it to the end or hung up. */
const replies = [];
/** Instructions of every model request (tests run in parallel), to see what reached the model. */
const instructions = [];

// Same shape as the live API's answer for a deleted conversation (spike S1, E11).
const notFound = (response, id) =>
  json(response, 404, {
    error: {
      message: `Conversation with id '${id}' not found.`,
      type: 'invalid_request_error',
      code: null,
    },
  });

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
  const reply = { text, outcome: 'streaming' };
  replies.push(reply);
  response.on('close', () => {
    if (!response.writableEnded) reply.outcome = 'aborted';
  });
  // "[slow]" in a message makes the reply take about a second, so tests can leave mid-answer.
  const pause = text.includes('[slow]') ? 150 : 20;
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  let sequence = 0;
  const send = (event) =>
    response.write(
      `event: ${event.type}\ndata: ${JSON.stringify({ ...event, sequence_number: sequence++ })}\n\n`,
    );
  send({ type: 'response.created', response: { id: 'resp_mock', status: 'in_progress' } });
  for (const word of text.split(/(?<= )/)) {
    await sleep(pause);
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
  if (reply.outcome === 'streaming') reply.outcome = 'completed';
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', `http://localhost:${PORT}`);
  if (pathname === '/health') return json(response, 200, { ok: true });
  if (request.method === 'POST' && pathname === '/v1/conversations') {
    const id = `conv_${nextConversation++}`;
    conversations.set(id, []);
    return json(response, 200, { id, object: 'conversation', created_at: 0, metadata: {} });
  }
  if (request.method === 'POST' && pathname === '/v1/responses') {
    const body = await readJson(request);
    instructions.push(body.instructions ?? '');
    const items = conversations.get(body.conversation);
    if (!items) return notFound(response, body.conversation);
    const content = body.input?.[0]?.content ?? '';
    const parts = typeof content === 'string' ? [{ type: 'input_text', text: content }] : content;
    const userText = parts.find((part) => part.type === 'input_text')?.text ?? '';
    const attached = parts.filter((part) => part.file_id).length;
    const reply = `You said: ${userText} (in ${body.conversation})${attached ? ` [${attached} files]` : ''}`;
    items.push(
      {
        id: `msg_${items.length}`,
        type: 'message',
        role: 'user',
        status: 'completed',
        content: parts,
      },
      {
        id: `msg_${items.length + 1}`,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: reply, annotations: [], logprobs: [] }],
      },
    );
    return streamResponse(response, reply);
  }
  const itemsPath = /^\/v1\/conversations\/([^/]+)\/items$/.exec(pathname);
  if (request.method === 'GET' && itemsPath) {
    const items = conversations.get(itemsPath[1]);
    if (!items) return notFound(response, itemsPath[1]);
    const order = new URL(request.url ?? '/', 'http://mock').searchParams.get('order') ?? 'desc';
    const data = order === 'asc' ? items : [...items].reverse();
    return json(response, 200, {
      object: 'list',
      data,
      first_id: data[0]?.id ?? null,
      last_id: data.at(-1)?.id ?? null,
      has_more: false,
    });
  }
  if (request.method === 'POST' && pathname === '/v1/audio/transcriptions') {
    for await (const _chunk of request) {
      // Drain the multipart upload; the server already checked it is a recording.
    }
    return json(response, 200, {
      text: 'Mock transcript',
      usage: { type: 'duration', seconds: 2 },
    });
  }
  if (request.method === 'POST' && pathname === '/v1/files') {
    for await (const _chunk of request) {
      // Drain the multipart upload; its content is not needed.
    }
    const id = `file-mock${nextFile++}`;
    files.add(id);
    return json(response, 200, { id, object: 'file', purpose: 'user_data', status: 'processed' });
  }
  if (request.method === 'DELETE' && pathname.startsWith('/v1/files/')) {
    const id = pathname.split('/').at(-1);
    if (!files.delete(id)) return json(response, 404, { error: { message: 'No such file' } });
    return json(response, 200, { id, deleted: true, object: 'file' });
  }
  if (request.method === 'GET' && pathname === '/debug/files')
    return json(response, 200, [...files]);
  if (request.method === 'GET' && pathname === '/debug/replies')
    return json(response, 200, replies);
  if (request.method === 'GET' && pathname === '/debug/instructions') {
    return json(response, 200, instructions);
  }
  if (request.method === 'DELETE' && pathname.startsWith('/v1/conversations/')) {
    const id = pathname.split('/').at(-1);
    conversations.delete(id);
    return json(response, 200, { id, deleted: true, object: 'conversation.deleted' });
  }
  json(response, 404, {
    error: { message: `Mock has no route for ${request.method} ${pathname}` },
  });
}).listen(PORT, '127.0.0.1', () => console.log(`mock OpenAI on http://127.0.0.1:${PORT}`));
