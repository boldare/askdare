import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFixtureStore } from './fixture-store';
import type { Recording } from './recorder';
import { type ChatState, canSend } from './state';
import { memoryStorage } from './storage';
import { createChatStore, type FocusTarget, type Recorder } from './store';
import { echo, fakeServer, testClient, testConfig } from './testing/fake-server';

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Waits until the store's state passes the check. */
async function until(store: { getSnapshot(): ChatState }, check: (state: ChatState) => boolean) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check(store.getSnapshot())) return;
    await settled();
  }
  throw new Error(`State never matched: ${JSON.stringify(store.getSnapshot())}`);
}

beforeEach(() => {
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createChatStore', () => {
  it('reads nothing before start(), and the server snapshot never changes', async () => {
    const storage = memoryStorage();
    const get = vi.spyOn(storage, 'get');
    const server = fakeServer();
    const store = createChatStore(testConfig(), {
      client: testClient(server, storage),
      page: { greeting: 'From the page' },
    });
    const initial = store.getServerSnapshot();
    expect(initial).toMatchObject({ phase: 'starting', messages: [], canDictate: false });
    expect(initial.page).toEqual({ greeting: 'From the page' });
    expect(get).not.toHaveBeenCalled();
    expect(server.requests).toEqual([]);

    store.start();
    await until(store, (state) => state.phase === 'ready');
    expect(store.getServerSnapshot()).toBe(initial);
  });

  it('sends the draft, streams the answer and asks for focus', async () => {
    const server = fakeServer();
    const store = createChatStore(testConfig(), { client: testClient(server) });
    const focus: FocusTarget[] = [];
    store.onFocus('input', () => focus.push('input') > 0);
    store.start();
    await until(store, (state) => state.phase === 'ready');

    store.actions.setDraft('  Hello  ');
    expect(canSend(store.getSnapshot())).toBe(true);
    await store.actions.send();

    const state = store.getSnapshot();
    expect(state.draft).toBe('');
    expect(state.busy).toBe(false);
    expect(state.messages.map(({ role, text, status }) => ({ role, text, status }))).toEqual([
      { role: 'user', text: 'Hello', status: 'done' },
      { role: 'assistant', text: 'You said: Hello', status: 'done' },
    ]);
    expect(focus).toEqual(['input']);
  });

  it('sends a starter without touching the draft', async () => {
    const store = createChatStore(testConfig(), { client: testClient(fakeServer()) });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    store.actions.setDraft('half-typed');
    await store.actions.send('What does the Business plan include?');
    expect(store.getSnapshot().draft).toBe('half-typed');
    expect(store.getSnapshot().messages[0]?.text).toBe('What does the Business plan include?');
  });

  it('sends nothing before the visitor is known', async () => {
    const server = fakeServer();
    const store = createChatStore(testConfig(), { client: testClient(server) });
    store.actions.setDraft('Too early');
    await store.actions.send();
    expect(store.getSnapshot().messages).toEqual([]);
    expect(server.requests).toEqual([]);
  });

  it('marks the streaming answer as failed when the turn ends in an error', async () => {
    const server = fakeServer({
      answer: () => [
        { type: 'message.start', messageId: 'msg_1' },
        { type: 'text.delta', messageId: 'msg_1', delta: 'Partial' },
        { type: 'error', code: 'timeout', message: 'Took too long.' },
      ],
    });
    const store = createChatStore(testConfig(), { client: testClient(server) });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.send('Question');
    const state = store.getSnapshot();
    expect(state.error).toBe('Took too long.');
    expect(state.messages.at(-1)).toMatchObject({ text: 'Partial', status: 'error' });
  });

  it('shows the activity while no text streams', async () => {
    const seen: (string | null)[] = [];
    const server = fakeServer({
      answer: () => [
        { type: 'message.start', messageId: 'msg_1' },
        {
          type: 'tool.status',
          messageId: 'msg_1',
          callId: 'c1',
          name: 'file_search',
          state: 'running',
        },
        { type: 'text.delta', messageId: 'msg_1', delta: 'Found it' },
        { type: 'message.end', messageId: 'msg_1', reason: 'completed' },
      ],
    });
    const store = createChatStore(testConfig(), { client: testClient(server) });
    store.subscribe(() => seen.push(store.getSnapshot().activity));
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.send('Search');
    expect(seen).toContain('Searching documents…');
    expect(store.getSnapshot().activity).toBeNull();
  });

  it('loads a stored conversation, showing it as loading from the start', async () => {
    const storage = memoryStorage();
    storage.set('askdare:support:resume', 'resume-1');
    const server = fakeServer({
      holdHistory: true,
      history: [
        { id: 'msg_a', role: 'assistant', text: 'Earlier answer', citations: [], attachments: 0 },
      ],
    });
    const store = createChatStore(testConfig(), { client: testClient(server, storage) });
    store.start();
    expect(store.getSnapshot().phase).toBe('loading');
    server.release();
    await until(store, (state) => state.phase === 'ready');
    expect(store.getSnapshot().messages).toEqual([
      {
        id: 'msg_a',
        role: 'assistant',
        text: 'Earlier answer',
        citations: [],
        attachments: 0,
        status: 'done',
      },
    ]);
  });

  it('waits for the handshake and the identity before the first request', async () => {
    const server = fakeServer({ identityKey: () => 'user-key' });
    const store = createChatStore(testConfig(), { client: testClient(server) });
    let connect = (): void => {};
    const handshake = new Promise<void>((resolve) => {
      connect = () => {
        store.identify('a.b.c');
        resolve();
      };
    });
    store.start({ handshake });
    await settled();
    expect(store.getSnapshot().phase).toBe('starting');
    expect(server.requests).toEqual([]);
    connect();
    await until(store, (state) => state.phase === 'ready');
    expect(server.requests[0]).toMatchObject({
      path: '/session',
      body: { identityToken: 'a.b.c' },
    });
  });

  it("shows the next user's conversation when the identity changes", async () => {
    const storage = memoryStorage();
    storage.set('askdare:support:resume:user-b', 'resume-b');
    const server = fakeServer({
      identityKey: (token) => (token === 'b.b.b' ? 'user-b' : 'user-a'),
      history: [
        { id: 'msg_b', role: 'assistant', text: "B's answer", citations: [], attachments: 0 },
      ],
    });
    const store = createChatStore(testConfig(), { client: testClient(server, storage) });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.send('Anonymous question');
    expect(store.getSnapshot().messages).toHaveLength(2);

    store.identify('b.b.b');
    await until(store, (state) => state.messages[0]?.id === 'msg_b');
    expect(store.getSnapshot().messages).toHaveLength(1);
  });

  it('is idempotent across start() and stop(), as Strict Mode runs effects twice', async () => {
    const storage = memoryStorage();
    storage.set('askdare:support:resume', 'resume-1');
    const server = fakeServer();
    const store = createChatStore(testConfig(), { client: testClient(server, storage) });
    store.start();
    store.start();
    store.stop();
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await settled();
    expect(server.requests.filter((request) => request.path === '/history')).toHaveLength(1);
  });

  it('refuses more files than a message may carry', async () => {
    const store = createChatStore(testConfig({ attachments: attachments() }), {
      client: testClient(fakeServer()),
    });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    store.actions.addFiles([pdf('a.pdf'), pdf('b.pdf'), pdf('c.pdf')]);
    expect(store.getSnapshot().error).toBe('You can attach up to 2 files per message.');
    expect(store.getSnapshot().files).toHaveLength(2);
    await until(store, (state) => state.files.every((file) => file.status === 'ready'));

    const [first] = store.getSnapshot().files;
    store.actions.removeFile(first?.key ?? '');
    expect(store.getSnapshot().files).toHaveLength(1);
  });

  it('dictates into the draft and turns the microphone off when hidden', async () => {
    const recorder = fakeRecorder();
    const server = fakeServer({ transcript: 'from the microphone' });
    const store = createChatStore(testConfig({ voice: { maxSeconds: 60 } }), {
      client: testClient(server),
      recorder,
    });
    const focus: FocusTarget[] = [];
    store.onFocus('input', () => focus.push('input') > 0);
    store.onFocus('dictation', () => focus.push('dictation') > 0);
    store.start();
    await until(store, (state) => state.phase === 'ready');
    expect(store.getSnapshot().canDictate).toBe(true);

    store.actions.setDraft('Typed and');
    await store.actions.startDictation();
    expect(store.getSnapshot().dictation).toBe('recording');
    expect(store.level()).toBe(0.5);
    await store.actions.finishDictation();
    expect(store.getSnapshot()).toMatchObject({
      dictation: 'idle',
      draft: 'Typed and from the microphone',
    });
    expect(focus).toEqual(['dictation', 'input']);

    await store.actions.startDictation();
    store.hide();
    expect(store.getSnapshot().dictation).toBe('idle');
    expect(recorder.cancelled).toBe(1);
  });

  it('starts no dictation while the last one is being transcribed', async () => {
    const recorder = fakeRecorder();
    const start = vi.spyOn(recorder, 'startRecording');
    const store = createChatStore(testConfig({ voice: { maxSeconds: 60 } }), {
      client: testClient(fakeServer()),
      recorder,
    });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.startDictation();
    const finishing = store.actions.finishDictation();
    expect(store.getSnapshot().dictation).toBe('transcribing');
    await store.actions.startDictation();
    await finishing;
    expect(start).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toMatchObject({ dictation: 'idle', draft: 'Dictated text' });
  });

  it('stops the answer being streamed when the chat stops', async () => {
    // The answer has begun, and its end never comes.
    const server = fakeServer({ holdAnswer: true, answer: (text) => echo(text).slice(0, 3) });
    const store = createChatStore(testConfig(), { client: testClient(server) });
    const focus = vi.fn(() => true);
    store.onFocus('input', focus);
    store.start();
    await until(store, (state) => state.phase === 'ready');
    const sending = store.actions.send('Hello');
    await until(store, (state) => state.messages.at(-1)?.status === 'streaming');
    store.stop();
    await sending;
    expect(store.getSnapshot()).toMatchObject({ busy: false, activity: null });
    expect(store.getSnapshot().messages.at(-1)?.status).toBe('error');
    expect(focus).not.toHaveBeenCalled();
  });

  it('marks a focus request of the page as explicit, and those of the chat as not', async () => {
    const store = createChatStore(testConfig(), { client: testClient(fakeServer()) });
    const requests: boolean[] = [];
    store.onFocus('input', (explicit) => requests.push(explicit) > 0);
    store.start();
    await until(store, (state) => state.phase === 'ready');
    store.actions.focus();
    await store.actions.send('Hello');
    expect(requests).toEqual([true, false]);
  });

  it('keeps a focus request until something really takes it', () => {
    const store = createChatStore(testConfig(), { client: testClient(fakeServer()) });
    store.actions.focus();
    // A listener whose element is gone (the field unmounts for a dictation) can't take it.
    const gone = vi.fn(() => false);
    store.onFocus('input', gone);
    expect(gone).toHaveBeenCalledOnce();
    const field = vi.fn(() => true);
    store.onFocus('input', field);
    expect(field).toHaveBeenCalledOnce();
    // Taken: a later listener gets nothing.
    const later = vi.fn(() => true);
    store.onFocus('input', later);
    expect(later).not.toHaveBeenCalled();
  });

  it('drops a focus request nobody took in time', () => {
    vi.useFakeTimers();
    try {
      const store = createChatStore(testConfig(), { client: testClient(fakeServer()) });
      store.actions.focus();
      vi.advanceTimersByTime(3_000);
      const late = vi.fn(() => true);
      store.onFocus('input', late);
      expect(late).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts over with an empty chat', async () => {
    const server = fakeServer();
    const store = createChatStore(testConfig(), { client: testClient(server) });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.send('Hello');
    await store.actions.newConversation();
    expect(store.getSnapshot()).toMatchObject({ messages: [], busy: false });
    expect(server.requests.some((request) => request.path === '/conversation')).toBe(true);
  });

  it('rates an answer, asks about a 👎, and remembers the rating in this browser', async () => {
    const storage = memoryStorage();
    const server = fakeServer();
    const store = createChatStore(testConfig(), { client: testClient(server, storage) });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.send('Hello');
    const answer = store.getSnapshot().messages.at(-1);
    expect(answer?.feedback).toEqual({ handle: 'handle-1', key: 'a1b2c3d4e5f60718' });
    const id = answer?.id ?? '';
    const sent = () =>
      server.requests.filter((request) => request.path === '/feedback').map(({ body }) => body);

    await store.actions.rate(id, 'up');
    expect(store.getSnapshot()).toMatchObject({
      ratings: { a1b2c3d4e5f60718: 'up' },
      commenting: undefined,
    });

    await store.actions.rate(id, 'down');
    expect(store.getSnapshot()).toMatchObject({
      ratings: { a1b2c3d4e5f60718: 'down' },
      commenting: id,
    });
    await store.actions.rate(id, 'down', '  It missed the yearly price.  ');
    expect(store.getSnapshot().commenting).toBeUndefined();

    expect(sent()).toEqual([
      { botId: 'support', feedback: 'handle-1', rating: 'up' },
      { botId: 'support', feedback: 'handle-1', rating: 'down' },
      {
        botId: 'support',
        feedback: 'handle-1',
        rating: 'down',
        comment: 'It missed the yearly price.',
      },
    ]);

    // A new visit in the same browser shows the rating again.
    const again = createChatStore(testConfig(), { client: testClient(fakeServer(), storage) });
    again.start();
    await until(again, (state) => state.ratings['a1b2c3d4e5f60718'] === 'down');

    await store.actions.rate(id, null);
    expect(store.getSnapshot().ratings).toEqual({});
    expect(sent().at(-1)).toEqual({ botId: 'support', feedback: 'handle-1', rating: null });
    expect(JSON.parse(storage.get('askdare:support:ratings') ?? '')).toEqual({});
  });

  it('takes a rating back when the server refuses it', async () => {
    const storage = memoryStorage();
    const store = createChatStore(testConfig(), {
      client: testClient(fakeServer({ refuseFeedback: true }), storage),
    });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.send('Hello');
    await store.actions.rate(store.getSnapshot().messages.at(-1)?.id ?? '', 'down');
    expect(store.getSnapshot()).toMatchObject({
      ratings: {},
      commenting: undefined,
      error: 'Too many messages. Please wait a moment.',
    });
    expect(storage.get('askdare:support:ratings')).toBeUndefined();
  });

  it('sends ratings of one answer in order, and shows the latest the server took', async () => {
    const storage = memoryStorage();
    const answers: ((accepted: boolean) => void)[] = [];
    const server = fakeServer({
      feedback: () => new Promise<boolean>((resolve) => answers.push(resolve)),
    });
    const store = createChatStore(testConfig(), { client: testClient(server, storage) });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.send('Hello');
    const id = store.getSnapshot().messages.at(-1)?.id ?? '';
    const sent = () => server.requests.filter((request) => request.path === '/feedback');

    // 👍 then 👎 before the first answer: the 👎 waits for the 👍, then the 👍 fails.
    const up = store.actions.rate(id, 'up');
    const down = store.actions.rate(id, 'down');
    await until(store, () => sent().length === 1);
    answers[0]?.(false);
    await up;
    expect(store.getSnapshot()).toMatchObject({
      ratings: { a1b2c3d4e5f60718: 'down' },
      commenting: id,
    });
    await until(store, () => sent().length === 2);
    answers[1]?.(true);
    await down;
    expect(store.getSnapshot()).toMatchObject({
      ratings: { a1b2c3d4e5f60718: 'down' },
      commenting: id,
    });
    expect(JSON.parse(storage.get('askdare:support:ratings') ?? '')).toEqual({
      a1b2c3d4e5f60718: 'down',
    });

    // A rating taken back that fails returns to the 👎 the server holds.
    const back = store.actions.rate(id, null);
    await until(store, () => sent().length === 3);
    answers[2]?.(false);
    await back;
    expect(store.getSnapshot().ratings).toEqual({ a1b2c3d4e5f60718: 'down' });
    expect(store.getSnapshot().error).toBe('Too many messages. Please wait a moment.');
  });

  it('keeps the question open with its comment until the comment is sent', async () => {
    let accept = true;
    const server = fakeServer({ feedback: async () => accept });
    const store = createChatStore(testConfig(), { client: testClient(server) });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.send('Hello');
    const id = store.getSnapshot().messages.at(-1)?.id ?? '';
    await store.actions.rate(id, 'down');

    accept = false;
    const sending = store.actions.rate(id, 'down', 'It missed the yearly price.');
    expect(store.getSnapshot().commenting).toBe(id);
    await sending;
    expect(store.getSnapshot()).toMatchObject({
      commenting: id,
      ratings: { a1b2c3d4e5f60718: 'down' },
      error: 'Too many messages. Please wait a moment.',
    });

    accept = true;
    await store.actions.rate(id, 'down', 'It missed the yearly price.');
    expect(store.getSnapshot()).toMatchObject({ commenting: undefined, error: undefined });
  });

  it('skips the question after a 👎 and ignores messages that cannot be rated', async () => {
    const server = fakeServer();
    const store = createChatStore(testConfig(), { client: testClient(server) });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.send('Hello');
    const [question, answer] = store.getSnapshot().messages;
    await store.actions.rate(question?.id ?? '', 'up');
    expect(server.requests.some((request) => request.path === '/feedback')).toBe(false);
    await store.actions.rate(answer?.id ?? '', 'down');
    store.actions.dismissComment();
    expect(store.getSnapshot()).toMatchObject({
      commenting: undefined,
      ratings: { a1b2c3d4e5f60718: 'down' },
    });
  });

  it('sends the page context only to a bot that accepts it', async () => {
    const server = fakeServer();
    const store = createChatStore(testConfig({ pageContext: true }), {
      client: testClient(server),
      page: { context: 'Pricing page' },
    });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.send('How much?');
    const message = server.requests.find((request) => request.path === '/messages');
    expect(message?.body['context']).toBe('Pricing page');
  });
});

describe('createFixtureStore', () => {
  it('shows a frozen state and talks to no server', async () => {
    const store = createFixtureStore(testConfig({ voice: { maxSeconds: 60 } }), {
      messages: [],
      draft: 'Draft',
      dictation: 'recording',
      elapsed: 7,
    });
    expect(store.getSnapshot()).toMatchObject({
      phase: 'ready',
      draft: 'Draft',
      dictation: 'recording',
      elapsed: 7,
      canDictate: true,
    });
    await store.actions.send();
    store.actions.setDraft('Changed');
    expect(store.getSnapshot().draft).toBe('Changed');
    expect(store.getSnapshot().messages).toEqual([]);
    expect(store.level()).toBeUndefined();
  });
});

function attachments() {
  return { images: true, pdf: true, maxBytes: 1_000_000, maxPerMessage: 2, maxPdfPages: 50 };
}

function pdf(name: string): File {
  return new File(['%PDF-1.4'], name, { type: 'application/pdf' });
}

function fakeRecorder(): Recorder & { cancelled: number } {
  const recorder = {
    cancelled: 0,
    canRecord: () => true,
    startRecording: async (): Promise<Recording> => ({
      level: () => 0.5,
      stop: async () => new Blob([new Uint8Array(2_000)], { type: 'audio/webm' }),
      cancel: () => {
        recorder.cancelled += 1;
      },
    }),
  };
  return recorder;
}
