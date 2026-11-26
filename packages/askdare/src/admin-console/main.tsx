/** @jsxImportSource preact */
/**
 * The admin console (ADR-0016 stage 1, ADR-0032): sign-in, each bot's configuration, doctor, a
 * playground and, with an admin store, the stored conversations. Built by Vite and inlined into
 * the package by scripts/inline-assets.mjs. Everything it shows is rendered as text, never HTML.
 */
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { API, ConsoleError, call, send, setToken, stream, whenSignedOut } from './api';
import './console.css';

type Json = Record<string, unknown>;
interface BotView extends Json {
  readonly id: string;
  readonly model: string;
  readonly instructions: string;
}
interface ConfigView {
  readonly bots: readonly BotView[];
  readonly store: { readonly name: string; readonly transcripts: boolean } | null;
  readonly retentionDays: number;
}

const root = document.getElementById('askdare-console');
const [dashboardScript, dashboardStyle] = (root?.dataset['dashboard'] ?? '').split(' ');
const ADMIN = API.replace(/\/api$/, '');

const messageOf = (error: unknown): string =>
  error instanceof ConsoleError || error instanceof Error ? error.message : String(error);

/** The identity token the app's admin page links with, taken off the address bar at once. */
function takeIdentity(): string | undefined {
  const match = /(?:^#|&)identity=([^&]+)/.exec(location.hash);
  if (!match?.[1]) return undefined;
  history.replaceState(null, '', location.pathname + location.search);
  return decodeURIComponent(match[1]);
}

function SignIn(props: { readonly onSignedIn: () => void }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const signIn = async (body: Json): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const session = await call<{ token: string }>('session', body);
      setToken(session.token);
      props.onSignedIn();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the page opens
  useEffect(() => {
    const identity = takeIdentity();
    if (identity) void signIn({ identity });
  }, []);
  return (
    <form
      class="ac-card ac-signin"
      onSubmit={(event) => {
        event.preventDefault();
        const input = (event.currentTarget as HTMLFormElement).elements.namedItem(
          'secret',
        ) as HTMLInputElement;
        void signIn({ secret: input.value });
        input.value = '';
      }}
    >
      <h1>askdare console</h1>
      <label>
        ADMIN_SECRET
        <input name="secret" type="password" autocomplete="off" required />
      </label>
      <button type="submit" disabled={busy}>
        Sign in
      </button>
      {error && <p class="ac-error">{error}</p>}
    </form>
  );
}

/** A value as readable text: nested objects indented, never HTML. */
function Value(props: { readonly value: unknown }) {
  const { value } = props;
  if (value === null || value === undefined) return <span class="ac-muted">none</span>;
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    return value.length === 0 ? (
      <span class="ac-muted">none</span>
    ) : (
      <span>{value.join(', ')}</span>
    );
  }
  const entries = Object.entries(value as Json);
  if (entries.length === 0) return <span class="ac-muted">none</span>;
  return (
    <dl class="ac-fields">
      {entries.map(([key, item]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            <Value value={item} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Bots(props: { readonly config: ConfigView }) {
  return (
    <div>
      {props.config.bots.map(({ instructions, ...bot }) => (
        <section class="ac-card" key={bot.id}>
          <h2>{bot.id}</h2>
          <h3>Instructions</h3>
          <pre class="ac-pre">{instructions}</pre>
          <Value value={bot} />
        </section>
      ))}
    </div>
  );
}

interface DoctorView {
  readonly bots: readonly {
    readonly id: string;
    readonly checks: readonly { status: string; title: string; fix?: string }[];
  }[];
}

function Doctor() {
  const [report, setReport] = useState<DoctorView>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      setReport(await call<DoctorView>('doctor'));
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section class="ac-card">
      <button type="button" onClick={run} disabled={busy}>
        {busy ? 'Checking…' : 'Run doctor'}
      </button>
      {error && <p class="ac-error">{error}</p>}
      {report?.bots.map((bot) => (
        <div key={bot.id}>
          <h2>{bot.id}</h2>
          <ul class="ac-checks">
            {bot.checks.map((check, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lists that are only ever replaced or appended to
              <li key={index} class={`ac-${check.status}`}>
                <strong>{check.status}</strong> {check.title}
                {check.fix && <div class="ac-muted">{check.fix}</div>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

interface Line {
  readonly role: 'user' | 'assistant' | 'error';
  readonly text: string;
}

function Playground(props: { readonly bots: readonly BotView[] }) {
  const [botId, setBotId] = useState(props.bots[0]?.id ?? '');
  const [lines, setLines] = useState<readonly Line[]>([]);
  const [busy, setBusy] = useState(false);
  const conversation = useRef<string | undefined>(undefined);

  const forget = (keepalive = false): void => {
    const reference = conversation.current;
    conversation.current = undefined;
    // Best effort: retention removes what this misses.
    if (reference) void send('delete', { conversation: reference }, keepalive).catch(() => {});
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: `forget` reads a ref, never stale
  useEffect(() => {
    const leave = (): void => forget(true);
    addEventListener('pagehide', leave);
    return () => removeEventListener('pagehide', leave);
  }, []);

  const ask = async (text: string): Promise<void> => {
    setBusy(true);
    setLines((current) => [...current, { role: 'user', text }, { role: 'assistant', text: '' }]);
    const append = (delta: string): void =>
      setLines((current) => {
        const last = current[current.length - 1];
        return last ? [...current.slice(0, -1), { ...last, text: last.text + delta }] : current;
      });
    try {
      await stream(
        'message',
        { botId, text, ...(conversation.current ? { conversation: conversation.current } : {}) },
        (event) => {
          if (event.type === 'text.delta') append(String(event['delta']));
          else if (event.type === 'citation') append(` [${String(event['title'])}]`);
          else if (event.type === 'conversation.created' || event.type === 'message.end') {
            const reference = event['resumeToken'];
            if (typeof reference === 'string') conversation.current = reference;
          } else if (event.type === 'error') {
            setLines((current) => [...current, { role: 'error', text: String(event['message']) }]);
          }
        },
      );
    } catch (failure) {
      setLines((current) => [...current, { role: 'error', text: messageOf(failure) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="ac-card">
      <div class="ac-row">
        <select
          value={botId}
          onChange={(event) => {
            forget();
            setLines([]);
            setBotId((event.currentTarget as HTMLSelectElement).value);
          }}
        >
          {props.bots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.id}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            forget();
            setLines([]);
          }}
        >
          New conversation
        </button>
      </div>
      <p class="ac-muted">
        Real turns: they count against the bot's limits and budgets and reach onUsage.
      </p>
      <ol class="ac-lines">
        {lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lists that are only ever replaced or appended to
          <li key={index} class={`ac-${line.role}`}>
            {line.text}
          </li>
        ))}
      </ol>
      <form
        class="ac-row"
        onSubmit={(event) => {
          event.preventDefault();
          const input = (event.currentTarget as HTMLFormElement).elements.namedItem(
            'text',
          ) as HTMLTextAreaElement;
          const text = input.value.trim();
          if (!text || busy) return;
          input.value = '';
          void ask(text);
        }}
      >
        <textarea name="text" rows={2} placeholder="Ask as a test visitor" />
        <button type="submit" disabled={busy}>
          Send
        </button>
      </form>
    </section>
  );
}

interface Summary {
  readonly reference: string;
  readonly bot: string;
  readonly firstAt: number;
  readonly lastAt: number;
  readonly turns: number;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
  readonly up: number;
  readonly down: number;
}
interface Review {
  readonly transcript?: readonly { input: string; answer?: string; at: number }[];
  readonly messages?: readonly { role: string; text: string }[];
}

function Conversations(props: { readonly reviewing?: string | undefined }) {
  const [items, setItems] = useState<readonly Summary[]>([]);
  const [order, setOrder] = useState<'latest' | 'tokens'>('latest');
  const [review, setReview] = useState<Review>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    call<{ items: Summary[] }>('conversations', { order })
      .then((page) => setItems(page.items))
      .catch((failure: unknown) => setError(messageOf(failure)));
  }, [order]);
  const open = (reference: string): void => {
    call<Review>('conversation', { conversation: reference })
      .then(setReview)
      .catch((failure: unknown) => setError(messageOf(failure)));
  };
  // A review the dashboard asked for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` only calls the API
  useEffect(() => {
    if (props.reviewing) open(props.reviewing);
  }, [props.reviewing]);
  return (
    <section class="ac-card">
      <div class="ac-row">
        <select
          value={order}
          onChange={(event) =>
            setOrder((event.currentTarget as HTMLSelectElement).value as 'latest' | 'tokens')
          }
        >
          <option value="latest">Latest</option>
          <option value="tokens">Most tokens</option>
        </select>
      </div>
      {error && <p class="ac-error">{error}</p>}
      <table class="ac-table">
        <thead>
          <tr>
            <th>Bot</th>
            <th>Last</th>
            <th>Turns</th>
            <th>Tokens</th>
            <th>👍/👎</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.reference}>
              <td>{item.bot}</td>
              <td>{new Date(item.lastAt).toLocaleString()}</td>
              <td>{item.turns}</td>
              <td>{item.usage.inputTokens + item.usage.outputTokens}</td>
              <td>
                {item.up}/{item.down}
              </td>
              <td>
                <button type="button" onClick={() => open(item.reference)}>
                  Review
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {review && (
        <ol class="ac-lines">
          {review.transcript?.flatMap((turn, index) => [
            // biome-ignore lint/suspicious/noArrayIndexKey: lists that are only ever replaced or appended to
            <li key={`u${index}`} class="ac-user">
              {turn.input}
            </li>,
            // biome-ignore lint/suspicious/noArrayIndexKey: lists that are only ever replaced or appended to
            <li key={`a${index}`} class="ac-assistant">
              {turn.answer ?? '(withheld)'}
            </li>,
          ])}
          {review.messages?.map((message, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lists that are only ever replaced or appended to
            <li key={index} class={`ac-${message.role}`}>
              {message.text}
            </li>
          ))}
          {!review.transcript?.length && !review.messages?.length && (
            <li class="ac-muted">Nothing stored for this conversation.</li>
          )}
        </ol>
      )}
    </section>
  );
}

/** What `@boldare/askdare-admin`'s script sets on `globalThis` once it has run. */
interface DashboardModule {
  mount(element: HTMLElement, host: DashboardHost): (() => void) | undefined;
}
interface DashboardHost {
  call(action: string, input: unknown): Promise<unknown>;
  review(reference: string): void;
}
const DASHBOARD_EVENT = 'askdare-admin-dashboard';
const loadedDashboard = (): DashboardModule | undefined =>
  (globalThis as { askdareAdminDashboard?: DashboardModule }).askdareAdminDashboard;

/**
 * The stage 2 dashboard (`@boldare/askdare-admin`): a classic script that sets
 * `globalThis.askdareAdminDashboard` and dispatches `askdare-admin-dashboard`. Its `host.call`
 * reaches its handlers through this session and rejects with an `Error` whose message is the code.
 */
function Dashboard(props: { readonly onReview: (reference: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: mounted once per visit of the view
  useEffect(() => {
    if (!host.current || !dashboardScript) return;
    let unmount: (() => void) | undefined;
    let left = false;
    const mount = (): void => {
      const dashboard = loadedDashboard();
      if (left || !host.current || !dashboard) return;
      try {
        unmount = dashboard.mount(host.current, {
          call: (action, input) =>
            call(`dashboard/${action}`, input).catch((failure: unknown) => {
              throw new Error(failure instanceof ConsoleError ? failure.code : 'internal_error');
            }),
          review: props.onReview,
        });
      } catch (failure) {
        setError(messageOf(failure));
      }
    };
    if (!document.querySelector('link[data-askdare-dashboard]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `${ADMIN}/${dashboardStyle}`;
      link.dataset['askdareDashboard'] = '';
      document.head.append(link);
    }
    if (loadedDashboard()) mount();
    else {
      addEventListener(DASHBOARD_EVENT, mount, { once: true });
      if (!document.querySelector('script[data-askdare-dashboard]')) {
        const script = document.createElement('script');
        script.src = `${ADMIN}/${dashboardScript}`;
        script.dataset['askdareDashboard'] = '';
        script.onerror = () => setError('The dashboard could not be loaded.');
        document.head.append(script);
      }
    }
    return () => {
      left = true;
      removeEventListener(DASHBOARD_EVENT, mount);
      unmount?.();
    };
  }, []);
  return (
    <section class="ac-card">
      {error && <p class="ac-error">{error}</p>}
      <div ref={host} />
    </section>
  );
}

const TABS = ['Bots', 'Doctor', 'Playground', 'Conversations', 'Dashboard'] as const;
type Tab = (typeof TABS)[number];

function Console(props: { readonly onSignOut: () => void }) {
  const [config, setConfig] = useState<ConfigView>();
  const [tab, setTab] = useState<Tab>('Bots');
  const [reviewing, setReviewing] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    call<ConfigView>('config')
      .then(setConfig)
      .catch((failure: unknown) => setError(messageOf(failure)));
  }, []);
  const tabs = TABS.filter(
    (name) =>
      (name !== 'Conversations' || config?.store) && (name !== 'Dashboard' || dashboardScript),
  );
  return (
    <div>
      <header class="ac-header">
        <strong>askdare console</strong>
        <nav>
          {tabs.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={tab === name}
              onClick={() => {
                setReviewing(undefined);
                setTab(name);
              }}
            >
              {name}
            </button>
          ))}
        </nav>
        <button type="button" onClick={props.onSignOut}>
          Sign out
        </button>
      </header>
      {error && <p class="ac-error">{error}</p>}
      {config && tab === 'Bots' && <Bots config={config} />}
      {tab === 'Doctor' && <Doctor />}
      {config && tab === 'Playground' && <Playground bots={config.bots} />}
      {tab === 'Conversations' && <Conversations reviewing={reviewing} />}
      {tab === 'Dashboard' && (
        <Dashboard
          onReview={(reference) => {
            setReviewing(reference);
            setTab('Conversations');
          }}
        />
      )}
    </div>
  );
}

function App() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => whenSignedOut(() => setSignedIn(false)), []);
  return signedIn ? (
    <Console
      onSignOut={() => {
        setToken(undefined);
        setSignedIn(false);
      }}
    />
  ) : (
    <SignIn onSignedIn={() => setSignedIn(true)} />
  );
}

if (root) render(<App />, root);
