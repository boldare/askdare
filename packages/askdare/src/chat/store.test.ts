import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFixtureStore } from './fixture-store';
import type { Recording } from './recorder';
import { type ChatState, canSend } from './state';
import { memoryStorage } from './storage';
import { createChatStore, type FocusTarget, type Recorder } from './store';
import { fakeServer, testClient, testConfig } from './testing/fake-server';

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
    store.onFocus('input', () => focus.push('input'));
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
    store.onFocus('input', () => focus.push('input'));
    store.onFocus('dictation', () => focus.push('dictation'));
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

  it('keeps a focus request until something can take it', () => {
    const store = createChatStore(testConfig(), { client: testClient(fakeServer()) });
    store.actions.focus();
    const focused = vi.fn();
    store.onFocus('input', focused);
    expect(focused).toHaveBeenCalledOnce();
    store.onFocus('input', focused);
    expect(focused).toHaveBeenCalledOnce();
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
