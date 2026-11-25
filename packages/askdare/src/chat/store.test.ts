import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryMessage, HistoryResponse } from '../protocol/history';
import type { ChatEvent } from './events';
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

  it('sends a picked text on its own, keeping the files and the draft for later', async () => {
    const server = fakeServer();
    const store = createChatStore(testConfig({ attachments: attachments() }), {
      client: testClient(server),
    });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    store.actions.setDraft('About this invoice');
    store.actions.addFiles([pdf('invoice.pdf')]);
    await until(store, (state) => state.files.every((file) => file.status === 'ready'));

    await store.actions.send('Show prices');
    const sent = server.requests.filter((request) => request.path === '/messages');
    expect(sent.at(-1)?.body['text']).toBe('Show prices');
    expect(sent.at(-1)?.body['attachments'] ?? []).toEqual([]);
    expect(store.getSnapshot().messages[0]).toMatchObject({ text: 'Show prices', attachments: 0 });
    expect(store.getSnapshot().files.map((file) => file.status)).toEqual(['ready']);
    expect(store.getSnapshot().draft).toBe('About this invoice');
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

describe('earlier messages', () => {
  const message = (id: string, role: 'user' | 'assistant' = 'user'): HistoryMessage => ({
    id,
    role,
    text: `Text of ${id}`,
    citations: [],
    attachments: 0,
  });
  /** A conversation of three pages: the latest, the one before (`c1`) and the oldest (`c2`). */
  const PAGES: Readonly<Record<string, HistoryResponse>> = {
    latest: { messages: [message('m5'), message('m6', 'assistant')], before: 'c1' },
    c1: { messages: [message('m3'), message('m4', 'assistant')], before: 'c2' },
    c2: { messages: [message('m1'), message('m2', 'assistant')] },
  };
  const pages = (before: string | undefined): HistoryResponse =>
    PAGES[before ?? 'latest'] ?? { messages: [] };

  function storeWith(options: Parameters<typeof fakeServer>[0]) {
    const storage = memoryStorage();
    storage.set('askdare:support:resume', 'resume-1');
    const server = fakeServer(options);
    const store = createChatStore(testConfig(), { client: testClient(server, storage) });
    return { server, store, storage };
  }
  const ids = (state: ChatState): string[] => state.messages.map((item) => item.id);
  const cursors = (server: ReturnType<typeof fakeServer>): unknown[] =>
    server.requests.filter((r) => r.path === '/history').map((r) => r.body['before']);

  it('has none without a stored conversation, or when it fits on one page', async () => {
    const fresh = createChatStore(testConfig(), { client: testClient(fakeServer()) });
    expect(fresh.getServerSnapshot().earlier).toBe('none');
    fresh.start();
    await until(fresh, (state) => state.phase === 'ready');
    expect(fresh.getSnapshot().earlier).toBe('none');

    const { store, server } = storeWith({ history: [message('m1')] });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    expect(store.getSnapshot().earlier).toBe('none');
    await store.actions.loadEarlier();
    expect(cursors(server)).toEqual([undefined]);
  });

  it('puts older pages above, back to the start of the conversation', async () => {
    const { store, server } = storeWith({ historyPage: pages });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    expect(store.getSnapshot()).toMatchObject({ earlier: 'more' });
    expect(ids(store.getSnapshot())).toEqual(['m5', 'm6']);

    const loading = store.actions.loadEarlier();
    expect(store.getSnapshot().earlier).toBe('loading');
    // A second call while a page loads asks for nothing.
    await store.actions.loadEarlier();
    await loading;
    expect(store.getSnapshot().earlier).toBe('more');
    expect(ids(store.getSnapshot())).toEqual(['m3', 'm4', 'm5', 'm6']);

    await store.actions.loadEarlier();
    expect(store.getSnapshot().earlier).toBe('none');
    expect(ids(store.getSnapshot())).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
    expect(store.getSnapshot().messages[0]).toMatchObject({ status: 'done', text: 'Text of m1' });
    await store.actions.loadEarlier();
    expect(cursors(server)).toEqual([undefined, 'c1', 'c2']);
  });

  it('keeps messages sent meanwhile below the older page', async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { store } = storeWith({
      historyPage: async (before) => {
        if (before) await held;
        return pages(before);
      },
    });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    const loading = store.actions.loadEarlier();
    await store.actions.send('New question');
    release();
    await loading;
    expect(store.getSnapshot().messages.map((item) => item.text)).toEqual([
      'Text of m3',
      'Text of m4',
      'Text of m5',
      'Text of m6',
      'New question',
      'You said: New question',
    ]);
  });

  it('shows an error and lets the visitor try the same page again', async () => {
    let fail = true;
    const { store, server } = storeWith({
      historyPage: (before) =>
        before && fail
          ? Response.json({ error: { code: 'internal_error' } }, { status: 500 })
          : pages(before),
    });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.loadEarlier();
    expect(store.getSnapshot()).toMatchObject({
      earlier: 'more',
      error: 'Could not load earlier messages.',
    });
    fail = false;
    await store.actions.loadEarlier();
    expect(store.getSnapshot()).toMatchObject({ earlier: 'more', error: undefined });
    expect(cursors(server)).toEqual([undefined, 'c1', 'c1']);
  });

  it('stops paging when the server refuses the cursor', async () => {
    const { store, storage } = storeWith({
      historyPage: (before) =>
        before
          ? Response.json(
              { error: { code: 'invalid_input', key: 'error.history' } },
              { status: 400 },
            )
          : pages(before),
    });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.loadEarlier();
    expect(store.getSnapshot()).toMatchObject({
      earlier: 'none',
      error: 'Could not load earlier messages.',
    });
    expect(ids(store.getSnapshot())).toEqual(['m5', 'm6']);
    // The conversation itself stays.
    expect(storage.get('askdare:support:resume')).toBe('resume-1');
  });

  it('drops a page that arrives after a new conversation started', async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { store } = storeWith({
      historyPage: async (before) => {
        if (before) await held;
        return pages(before);
      },
    });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    const loading = store.actions.loadEarlier();
    await store.actions.newConversation();
    expect(store.getSnapshot()).toMatchObject({ earlier: 'none', messages: [] });
    release();
    await loading;
    expect(store.getSnapshot()).toMatchObject({ earlier: 'none', messages: [] });
  });

  it("never pages into the previous visitor's conversation after a sign-in", async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const storage = memoryStorage();
    storage.set('askdare:support:resume', 'resume-anonymous');
    storage.set('askdare:support:resume:user-b', 'resume-b');
    const server = fakeServer({
      identityKey: () => 'user-b',
      historyPage: async (before, resumeToken) => {
        if (resumeToken === 'resume-b') return { messages: [message('b1')] };
        if (before) await held;
        return pages(before);
      },
    });
    const store = createChatStore(testConfig(), { client: testClient(server, storage) });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    // The anonymous conversation has older pages; one is on its way when the visitor signs in.
    const loading = store.actions.loadEarlier();
    store.identify('b.b.b');
    await until(store, (state) => state.messages[0]?.id === 'b1');
    release();
    await loading;
    expect(ids(store.getSnapshot())).toEqual(['b1']);
    expect(store.getSnapshot().earlier).toBe('none');
    await store.actions.loadEarlier();
    expect(cursors(server)).toEqual([undefined, 'c1', undefined]);
  });

  it('can load the same page again after stop() and start()', async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let hold = true;
    const { store, server } = storeWith({
      historyPage: async (before) => {
        if (before && hold) await held;
        return pages(before);
      },
    });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    const loading = store.actions.loadEarlier();
    store.stop();
    expect(store.getSnapshot().earlier).toBe('more');
    hold = false;
    release();
    await loading;
    expect(ids(store.getSnapshot())).toEqual(['m5', 'm6']);
    store.start();
    await store.actions.loadEarlier();
    expect(ids(store.getSnapshot())).toEqual(['m3', 'm4', 'm5', 'm6']);
    expect(cursors(server)).toEqual([undefined, 'c1', 'c1']);
  });
});

describe('setLocale', () => {
  it('switches the texts in place, keeping the conversation and the draft', async () => {
    const server = fakeServer();
    const store = createChatStore(testConfig(), { client: testClient(server) });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.send('Before');
    store.actions.setDraft('half-typed');
    const before = store.getSnapshot();
    let renders = 0;
    store.subscribe(() => {
      renders += 1;
    });

    expect(await store.setLocale('pl-PL')).toBe(true);
    expect(server.requests.at(-1)?.path).toBe('/config/support?lang=pl-PL');
    expect(store.config.widget.locale).toBe('pl-PL');
    expect(store.config.widget.greeting).toBe('Greeting in pl-PL');
    // The look and the rest of the config stay.
    expect(store.config.widget.preset).toBe('aura');
    expect(store.config.widget.title).toBe('Brightloop assistant');
    expect(store.t('composer.send')).toBe('Wyślij');
    expect(store.language).toBe('pl-PL');
    expect(renders).toBe(1);
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.messages).toBe(before.messages);
    expect(after.draft).toBe('half-typed');

    // The next message carries the new language.
    await store.actions.send('After');
    const sent = server.requests.filter((request) => request.path === '/messages');
    expect(sent.map((request) => request.body['locale'])).toEqual(['en', 'pl-PL']);
  });

  it('lets an answer under way finish', async () => {
    const server = fakeServer({ holdAnswer: true });
    const store = createChatStore(testConfig(), { client: testClient(server) });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    const sending = store.actions.send('Long answer');
    await until(store, (state) => state.messages.at(-1)?.text === 'You said: Long answer');
    expect(await store.setLocale('pl')).toBe(true);
    expect(store.getSnapshot().busy).toBe(true);
    server.release();
    await sending;
    expect(store.getSnapshot().messages.at(-1)).toMatchObject({
      text: 'You said: Long answer',
      status: 'done',
    });
  });

  it('keeps the current texts when the route fails', async () => {
    const server = fakeServer({ failConfig: true });
    const store = createChatStore(testConfig(), { client: testClient(server) });
    store.start();
    await until(store, (state) => state.phase === 'ready');
    expect(await store.setLocale('pl')).toBe(false);
    expect(store.config.widget.locale).toBe('en');
    expect(store.t('composer.send')).toBe('Send');
    await store.actions.send('Still English');
    const sent = server.requests.find((request) => request.path === '/messages');
    expect(sent?.body['locale']).toBe('en');
  });

  it('applies only the latest of quick switches', async () => {
    const server = fakeServer({ holdConfig: true });
    const store = createChatStore(testConfig(), { client: testClient(server) });
    const first = store.setLocale('pl');
    const second = store.setLocale('de');
    server.release();
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(store.config.widget.locale).toBe('de');
  });

  it('takes the texts of a config it is given, without a request', async () => {
    const server = fakeServer();
    const store = createChatStore(testConfig(), { client: testClient(server) });
    const polish = testConfig();
    const next = {
      ...polish,
      widget: {
        ...polish.widget,
        locale: 'pl',
        greeting: 'Cześć',
        texts: { 'composer.send': 'Wyślij' },
      },
    };
    expect(await store.setLocale('pl', next)).toBe(true);
    expect(store.config.widget.greeting).toBe('Cześć');
    expect(store.t('composer.send')).toBe('Wyślij');
    expect(server.requests).toEqual([]);
  });
});

describe('chat events', () => {
  /** Events without the duration, which depends on the clock. */
  const recorded = (events: ChatEvent[]) =>
    events.map((event) => {
      if (event.type !== 'message.received') return event;
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
      const { durationMs: _duration, ...rest } = event;
      return rest;
    });

  it('reports a whole visit, with metadata and no content', async () => {
    let turns = 0;
    const server = fakeServer({
      answer: (text) => {
        const messageId = `msg_${++turns}`;
        return [
          { type: 'message.start', messageId },
          { type: 'text.delta', messageId, delta: `You said: ${text} [1]` },
          { type: 'citation', messageId, index: 1, title: 'Pricing.pdf' },
          {
            type: 'message.end',
            messageId,
            reason: 'completed',
            feedback: { handle: 'handle-1', key: 'a1b2c3d4e5f60718' },
          },
        ];
      },
    });
    const store = createChatStore(testConfig(), { client: testClient(server) });
    const events: ChatEvent[] = [];
    store.onEvent((event) => events.push(event));
    store.start();
    await until(store, (state) => state.phase === 'ready');

    store.actions.setDraft('My secret question');
    await store.actions.send();
    await store.actions.send('A starter');
    const id = store.getSnapshot().messages.at(-1)?.id ?? '';
    await store.actions.rate(id, 'down', 'Secret comment');
    await store.actions.newConversation();

    expect(recorded(events)).toEqual([
      { type: 'ready', bot: 'support' },
      { type: 'message.sent', bot: 'support', length: 18, attachments: 0, source: 'typed' },
      { type: 'message.received', bot: 'support', outcome: 'completed', citations: 1 },
      { type: 'message.sent', bot: 'support', length: 9, attachments: 0, source: 'starter' },
      { type: 'message.received', bot: 'support', outcome: 'completed', citations: 1 },
      { type: 'feedback', bot: 'support', rating: 'down', commented: true },
      { type: 'conversation.reset', bot: 'support' },
    ]);
    const serialized = JSON.stringify(events);
    for (const secret of ['secret', 'Secret', 'Pricing', 'handle-1', 'a1b2c3', 'msg_']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("sends a reply option as the visitor's own text, reported as a reply", async () => {
    let turn = 0;
    const server = fakeServer({
      answer: (text) => {
        turn += 1;
        const messageId = `msg_${turn}`;
        return [
          { type: 'message.start', messageId },
          { type: 'text.delta', messageId, delta: `You said: ${text}` },
          { type: 'replies', messageId, items: ['Show prices', 'Talk to a person'] },
          { type: 'message.end', messageId, reason: 'completed' },
        ];
      },
    });
    const store = createChatStore(testConfig(), { client: testClient(server) });
    const events: ChatEvent[] = [];
    store.onEvent((event) => events.push(event));
    store.start();
    await until(store, (state) => state.phase === 'ready');

    await store.actions.send('A starter');
    expect(store.getSnapshot().messages.at(-1)?.replies).toEqual([
      'Show prices',
      'Talk to a person',
    ]);
    await store.actions.send('Show prices');
    // Typing an option's text into the field is still typing.
    store.actions.setDraft('Talk to a person');
    await store.actions.send();

    const sent = events.filter((event) => event.type === 'message.sent');
    expect(sent.map((event) => event.source)).toEqual(['starter', 'reply', 'typed']);
    const messages = server.requests.filter((request) => request.path === '/messages');
    expect(messages.map((request) => request.body['text'])).toEqual([
      'A starter',
      'Show prices',
      'Talk to a person',
    ]);
    expect(Object.keys(messages[1]?.body ?? {}).sort()).toEqual(
      Object.keys(messages[0]?.body ?? {}).sort(),
    );
  });

  it('reports a failed turn with its code', async () => {
    const server = fakeServer({
      answer: () => [
        { type: 'message.start', messageId: 'msg_1' },
        { type: 'error', code: 'timeout', message: 'Took too long.' },
      ],
    });
    const store = createChatStore(testConfig(), { client: testClient(server) });
    const events: ChatEvent[] = [];
    store.onEvent((event) => events.push(event));
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.send('Question');
    expect(recorded(events).slice(2)).toEqual([
      { type: 'error', bot: 'support', code: 'timeout' },
      { type: 'message.received', bot: 'support', outcome: 'failed', citations: 0 },
    ]);
  });

  it('reports an answer stopped with the chat', async () => {
    const server = fakeServer({ holdAnswer: true, answer: (text) => echo(text).slice(0, 3) });
    const store = createChatStore(testConfig(), { client: testClient(server) });
    const events: ChatEvent[] = [];
    store.onEvent((event) => events.push(event));
    store.start();
    await until(store, (state) => state.phase === 'ready');
    const sending = store.actions.send('Hello');
    await until(store, (state) => state.messages.at(-1)?.status === 'streaming');
    store.stop();
    await sending;
    expect(events.at(-1)).toMatchObject({ type: 'message.received', outcome: 'stopped' });
  });

  it('reports an answer under way to a listener as the chat stops', async () => {
    const server = fakeServer({ holdAnswer: true, answer: (text) => echo(text).slice(0, 3) });
    const store = createChatStore(testConfig(), { client: testClient(server) });
    const events: ChatEvent[] = [];
    const stopListening = store.onEvent((event) => events.push(event));
    store.start();
    await until(store, (state) => state.phase === 'ready');
    const sending = store.actions.send('Hello');
    await until(store, (state) => state.messages.at(-1)?.status === 'streaming');
    // As Root and the widget do: stop the chat, then stop listening.
    store.stop();
    stopListening();
    expect(events.at(-1)).toMatchObject({ type: 'message.received', outcome: 'stopped' });
    await sending;
    expect(events.filter((event) => event.type === 'message.received')).toHaveLength(1);
  });

  it("isn't ready while loading the stored conversation fails", async () => {
    const storage = memoryStorage();
    storage.set('askdare:support:resume', 'resume-1');
    const server = fakeServer();
    const failing: typeof fetch = (input, init) =>
      String(input).includes('/history')
        ? Promise.resolve(new Response('{}', { status: 500 }))
        : server.fetch(input, init);
    const store = createChatStore(testConfig(), {
      client: testClient({ ...server, fetch: failing }, storage),
    });
    const events: ChatEvent[] = [];
    store.onEvent((event) => events.push(event));
    store.start();
    await until(store, (state) => state.phase === 'ready');
    expect(store.getSnapshot().error).toBeDefined();
    expect(events).toEqual([]);
  });

  it('counts characters, not UTF-16 units', async () => {
    const store = createChatStore(testConfig(), { client: testClient(fakeServer()) });
    const events: ChatEvent[] = [];
    store.onEvent((event) => events.push(event));
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.send('Hi 👋');
    expect(events).toContainEqual(expect.objectContaining({ type: 'message.sent', length: 4 }));
  });

  it('reports a rating only once the server took it', async () => {
    const store = createChatStore(testConfig(), {
      client: testClient(fakeServer({ refuseFeedback: true })),
    });
    const events: ChatEvent[] = [];
    store.onEvent((event) => events.push(event));
    store.start();
    await until(store, (state) => state.phase === 'ready');
    await store.actions.send('Hello');
    await store.actions.rate(store.getSnapshot().messages.at(-1)?.id ?? '', 'up');
    expect(events.some((event) => event.type === 'feedback')).toBe(false);
  });

  it('keeps the chat going when a listener throws, and stops calling one that unsubscribed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createChatStore(testConfig(), { client: testClient(fakeServer()) });
    const later = vi.fn();
    store.onEvent(() => {
      throw new Error('broken analytics');
    });
    const stop = store.onEvent(later);
    store.start();
    await until(store, (state) => state.phase === 'ready');
    stop();
    await store.actions.send('Hello');
    expect(store.getSnapshot().messages.at(-1)?.text).toBe('You said: Hello');
    expect(later).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[askdare] A listener for "ready" threw.');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('broken analytics');
    warn.mockRestore();
  });

  it('fires ready once, not again when a sign-in reloads the conversation', async () => {
    const store = createChatStore(testConfig(), { client: testClient(fakeServer()) });
    const events: ChatEvent[] = [];
    store.onEvent((event) => events.push(event));
    store.start();
    await until(store, (state) => state.phase === 'ready');
    store.identify('token-of-ada');
    await settled();
    await until(store, (state) => state.phase === 'ready');
    expect(events.filter((event) => event.type === 'ready')).toHaveLength(1);
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
