// Minimal stand-in for the OpenAI API used by end-to-end tests. The starter reaches it through
// OPENAI_BASE_URL, so no real API call (or key) is ever involved.
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_OPENAI_PORT ?? 4010);
let nextConversation = 1;
/** Stored items per conversation, oldest first, as the Conversations API keeps them. */
const conversations = new Map();
/** Each conversation's metadata (askdare's bot and owner), which the server checks on resume. */
const metadata = new Map();
let nextFile = 1;
/** Uploaded files that still exist, so tests can check they are deleted. */
const files = new Set();
/** Each streamed reply and whether the caller read it to the end or hung up. */
const replies = [];
/** Every model request's instructions and input (tests run in parallel), to see what reached the model. */
const requests = [];

/** A conversation as `POST /v1/conversations` and `GET /v1/conversations/{id}` answer it. */
const conversationObject = (id) => ({
  id,
  object: 'conversation',
  created_at: 0,
  metadata: metadata.get(id) ?? {},
});

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

/**
 * Reply options for a message with "[options]" (after the answer, in the same response) or
 * "[options-first]" (before it, so the answer takes a second request); only when the request offers
 * `suggest_replies` and lets the model call it.
 */
const OPTIONS = ['**Show** prices', 'Talk to a person', 'See www.example.com'];
const suggests = (body, text) =>
  body.tool_choice === 'auto' &&
  Boolean(body.tools?.some((tool) => tool.name === 'suggest_replies')) &&
  /\[options(-first)?\]/.test(text);

/**
 * A tool card (ADR-0017) for a message with "[card]": the model first calls the site's
 * `get_current_time` tool, which runs without network access, then answers.
 */
const callsClock = (body, text) =>
  text.includes('[card]') && Boolean(body.tools?.some((tool) => tool.name === 'get_current_time'));

/**
 * Earlier turns for a conversation whose first message has "[long]": enough stored items for
 * POST /history to answer in pages (about 100 items each), oldest first.
 */
const LONG_TURNS = 60;
const earlierTurns = () =>
  Array.from({ length: LONG_TURNS }, (_, index) => [
    {
      id: `seed_q${index + 1}`,
      type: 'message',
      role: 'user',
      status: 'completed',
      content: [{ type: 'input_text', text: `Earlier question ${index + 1}` }],
    },
    {
      id: `seed_a${index + 1}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: `Earlier answer ${index + 1}`,
          annotations: [],
          logprobs: [],
        },
      ],
    },
  ]).flat();

/** A function call no output answers yet, which the live API refuses to continue (spike S1). */
const danglingCall = (items, input) => {
  const answered = new Set(
    [...items, ...input]
      .filter((item) => item.type === 'function_call_output')
      .map((item) => item.call_id),
  );
  return items.find((item) => item.type === 'function_call' && !answered.has(item.call_id));
};

/**
 * A response's stream. `output` is the terminal event's `response.output`, which only a stateless
 * turn reads (it stores those items itself); the Conversations API keeps them for the others.
 */
async function streamResponse(response, text, itemId = 'msg', call = undefined, output = []) {
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
  // The answer's item, announced before its text as the live API does: ratings refer to its id.
  if (text) {
    send({
      type: 'response.output_item.added',
      output_index: 0,
      item: { id: itemId, type: 'message', role: 'assistant', status: 'in_progress', content: [] },
    });
  }
  for (const word of text ? text.split(/(?<= )/) : []) {
    await sleep(pause);
    send({
      type: 'response.output_text.delta',
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      delta: word,
      logprobs: [],
    });
  }
  if (call) send({ type: 'response.output_item.done', output_index: 1, item: call });
  send({
    type: 'response.completed',
    response: {
      id: 'resp_mock',
      status: 'completed',
      incomplete_details: null,
      output,
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

let nextStateless = 1;

/**
 * A turn of a conversation whose store keeps its own items (stateless turns): no `conversation`,
 * `store: false` and the whole conversation so far as input. The reply says which visitor message
 * it answers, counted in that input, so a test sees the stored history reach the model.
 */
function statelessResponse(response, body) {
  const invalid = (message) =>
    json(response, 400, { error: { message, type: 'invalid_request_error', code: null } });
  if (body.store !== false) return invalid('A request without a conversation must not be stored.');
  if (body.truncation) return invalid('truncation needs a stored conversation.');
  const input = Array.isArray(body.input) ? body.input : [];
  const dangling = danglingCall(input, []);
  if (dangling) return invalid(`No tool output found for function call ${dangling.call_id}.`);
  // `type` is optional on an input message.
  const visitor = input.filter(
    (item) => (item.type ?? 'message') === 'message' && item.role === 'user',
  );
  const content = visitor.at(-1)?.content ?? '';
  const parts = typeof content === 'string' ? [{ type: 'input_text', text: content }] : content;
  const userText =
    parts.find(
      (part) => part.type === 'input_text' && !part.text.startsWith('[askdare:page-context]'),
    )?.text ?? '';
  const n = nextStateless++;
  // "[card]" calls the clock first; the next request then carries its output.
  if (input.at(-1)?.role === 'user' && callsClock(body, userText)) {
    const clock = {
      id: `fc_stateless_${n}`,
      type: 'function_call',
      call_id: `call_stateless_${n}`,
      name: 'get_current_time',
      arguments: JSON.stringify({ timeZone: 'Europe/Warsaw' }),
      status: 'completed',
    };
    return streamResponse(response, '', undefined, clock, [clock]);
  }
  const reply = `You said: ${userText} (stateless, visitor message ${visitor.length})`;
  const message = {
    id: `msg_stateless_${n}`,
    type: 'message',
    role: 'assistant',
    status: 'completed',
    content: [{ type: 'output_text', text: reply, annotations: [], logprobs: [] }],
  };
  return streamResponse(response, reply, message.id, undefined, [message]);
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', `http://localhost:${PORT}`);
  if (pathname === '/health') return json(response, 200, { ok: true });
  if (request.method === 'POST' && pathname === '/v1/conversations') {
    const id = `conv_${nextConversation++}`;
    conversations.set(id, []);
    metadata.set(id, (await readJson(request)).metadata ?? {});
    return json(response, 200, conversationObject(id));
  }
  const conversationPath = /^\/v1\/conversations\/([^/]+)$/.exec(pathname);
  if (request.method === 'GET' && conversationPath) {
    const id = conversationPath[1];
    if (!conversations.has(id)) return notFound(response, id);
    return json(response, 200, conversationObject(id));
  }
  // What `askdare doctor` checks: the model exists, and a short response outside a conversation.
  const modelPath = /^\/v1\/models\/([^/]+)$/.exec(pathname);
  if (request.method === 'GET' && modelPath) {
    return json(response, 200, { id: modelPath[1], object: 'model', created: 0, owned_by: 'mock' });
  }
  if (request.method === 'POST' && pathname === '/v1/responses') {
    const body = await readJson(request);
    if (!body.conversation && !body.stream) {
      return json(response, 200, {
        id: 'resp_doctor',
        object: 'response',
        created_at: 0,
        status: 'completed',
        model: body.model,
        output: [
          {
            id: 'msg_doctor',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'OK', annotations: [] }],
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
    }
    requests.push({ instructions: body.instructions ?? '', input: JSON.stringify(body.input) });
    if (!body.conversation) return statelessResponse(response, body);
    const items = conversations.get(body.conversation);
    if (!items) return notFound(response, body.conversation);
    const input = body.input ?? [];
    const dangling = danglingCall(items, input);
    if (dangling) {
      return json(response, 400, {
        error: {
          message: `No tool output found for function call ${dangling.call_id}.`,
          type: 'invalid_request_error',
          code: null,
        },
      });
    }
    // The step after "[options-first]": the call's output, then the answer to the visitor's message.
    if (input[0]?.type === 'function_call_output') {
      items.push(...input.map((item, index) => ({ id: `out_${items.length + index}`, ...item })));
      const asked = items.findLast((item) => item.type === 'message' && item.role === 'user');
      const text = asked?.content.find((part) => part.type === 'input_text')?.text ?? '';
      const reply = `You said: ${text} (in ${body.conversation})`;
      items.push({
        id: `msg_${items.length}`,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: reply, annotations: [], logprobs: [] }],
      });
      return streamResponse(response, reply, items.at(-1).id);
    }
    const content = input[0]?.content ?? '';
    const parts = typeof content === 'string' ? [{ type: 'input_text', text: content }] : content;
    // The visitor's own text, not the page context part that may precede it.
    const userText =
      parts.find(
        (part) => part.type === 'input_text' && !part.text.startsWith('[askdare:page-context]'),
      )?.text ?? '';
    const attached = parts.filter((part) => part.file_id).length;
    const reply = `You said: ${userText} (in ${body.conversation})${attached ? ` [${attached} files]` : ''}`;
    if (userText.includes('[long]') && items.length === 0) items.push(...earlierTurns());
    items.push({
      id: `msg_${items.length}`,
      type: 'message',
      role: 'user',
      status: 'completed',
      content: parts,
    });
    if (callsClock(body, userText)) {
      const clock = {
        id: `fc_${items.length}`,
        type: 'function_call',
        call_id: `call_${items.length}`,
        name: 'get_current_time',
        arguments: JSON.stringify({ timeZone: 'Europe/Warsaw' }),
        status: 'completed',
      };
      items.push(clock);
      return streamResponse(response, '', undefined, clock);
    }
    const call = suggests(body, userText)
      ? {
          id: `fc_${items.length}`,
          type: 'function_call',
          call_id: `call_${items.length}`,
          name: 'suggest_replies',
          arguments: JSON.stringify({ items: OPTIONS }),
          status: 'completed',
        }
      : undefined;
    if (call && userText.includes('[options-first]')) {
      items.push(call);
      return streamResponse(response, '', undefined, call);
    }
    items.push({
      id: `msg_${items.length}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: reply, annotations: [], logprobs: [] }],
    });
    if (call) items.push(call);
    return streamResponse(
      response,
      reply,
      items.findLast((item) => item.type === 'message').id,
      call,
    );
  }
  const itemsPath = /^\/v1\/conversations\/([^/]+)\/items$/.exec(pathname);
  // Items added outside a model call: the answer to a `suggest_replies` call that followed the answer.
  if (request.method === 'POST' && itemsPath) {
    const items = conversations.get(itemsPath[1]);
    if (!items) return notFound(response, itemsPath[1]);
    const added = (await readJson(request)).items.map((item, index) => ({
      id: `item_${items.length + index}`,
      ...item,
    }));
    items.push(...added);
    return json(response, 200, { object: 'list', data: added, has_more: false });
  }
  if (request.method === 'GET' && itemsPath) {
    const items = conversations.get(itemsPath[1]);
    if (!items) return notFound(response, itemsPath[1]);
    // Pages as the live API does: `after` is the last item of the page before, in `order`.
    const params = new URL(request.url ?? '/', 'http://mock').searchParams;
    const ordered = params.get('order') === 'asc' ? items : [...items].reverse();
    const after = params.get('after');
    const start = after ? ordered.findIndex((item) => item.id === after) + 1 : 0;
    const limit = Number(params.get('limit') ?? ordered.length);
    const data = ordered.slice(start, start + limit);
    return json(response, 200, {
      object: 'list',
      data,
      first_id: data[0]?.id ?? null,
      last_id: data.at(-1)?.id ?? null,
      has_more: start + limit < ordered.length,
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
  if (request.method === 'GET' && pathname === '/debug/requests') {
    return json(response, 200, requests);
  }
  if (request.method === 'DELETE' && pathname.startsWith('/v1/conversations/')) {
    const id = pathname.split('/').at(-1);
    conversations.delete(id);
    metadata.delete(id);
    return json(response, 200, { id, deleted: true, object: 'conversation.deleted' });
  }
  json(response, 404, {
    error: { message: `Mock has no route for ${request.method} ${pathname}` },
  });
}).listen(PORT, '127.0.0.1', () => console.log(`mock OpenAI on http://127.0.0.1:${PORT}`));
