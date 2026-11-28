/**
 * The dashboard's views. Everything the store returns is rendered as text nodes, never as HTML:
 * transcripts and comments are visitors' and the model's words (ADR-0004).
 */
import { useEffect, useState } from 'preact/hooks';
import type {
  WireConversation,
  WireDays,
  WirePage,
  WireRating,
  WireTokens,
  WireTranscript,
} from '../wire';
import { daysBetween, formatCost, formatInteger, formatRate, formatTime, lastDays } from './format';
import type { DashboardHost } from './host';

type View = 'overview' | 'conversations' | 'ratings';
interface Filter {
  readonly from: string;
  readonly to: string;
  readonly bot?: string;
}
interface Props {
  readonly host: DashboardHost;
}

const RANGES = [7, 30, 90] as const;

/** Loads `action` with `input` whenever `key` changes. */
function useQuery<T>(host: DashboardHost, action: string, input: unknown, key: string) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    let live = true;
    setState({});
    host.call(action, input).then(
      (data) => live && setState({ data: data as T }),
      (error: unknown) =>
        live && setState({ error: error instanceof Error ? error.message : 'internal_error' }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return state;
}

const tokenSum = (tokens: WireTokens): number => tokens.input + tokens.output;

export function App({ host }: Props) {
  const [days, setDays] = useState<number>(30);
  const [bot, setBot] = useState<string>('');
  const [view, setView] = useState<View>('overview');
  const [review, setReview] = useState<string | undefined>();
  const filter: Filter = { ...lastDays(days), ...(bot ? { bot } : {}) };
  const overview = useQuery<WireDays>(host, 'days', filter, JSON.stringify(filter));
  const bots = overview.data?.bots ?? [];

  return (
    <div class="askdare-dashboard">
      <header class="ad-bar">
        <nav class="ad-tabs" aria-label="Dashboard views">
          {(
            [
              ['overview', 'Overview'],
              ['conversations', 'Conversations'],
              ['ratings', '👎 answers'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id && review === undefined}
              onClick={() => {
                setView(id);
                setReview(undefined);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
        <div class="ad-filters">
          <label>
            Days{' '}
            <select value={days} onChange={(event) => setDays(Number(event.currentTarget.value))}>
              {RANGES.map((count) => (
                <option key={count} value={count}>
                  Last {count}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bot{' '}
            <select value={bot} onChange={(event) => setBot(event.currentTarget.value)}>
              <option value="">All bots</option>
              {[...new Set([...bots, ...(bot ? [bot] : [])])].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {review !== undefined ? (
        <Review host={host} reference={review} onBack={() => setReview(undefined)} />
      ) : view === 'overview' ? (
        <Overview state={overview} />
      ) : view === 'conversations' ? (
        <Conversations host={host} filter={filter} onReview={setReview} />
      ) : (
        <Ratings host={host} filter={filter} onReview={setReview} />
      )}
    </div>
  );
}

function Status({ error }: { readonly error?: string | undefined }) {
  return error === undefined ? (
    <p class="ad-muted">Loading…</p>
  ) : (
    <p class="ad-error" role="alert">
      Couldn't load this ({error}).
    </p>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div class="ad-tile">
      <span class="ad-muted">{label}</span>
      <strong>{value}</strong>
      {hint ? <small class="ad-muted">{hint}</small> : null}
    </div>
  );
}

function Overview({ state }: { readonly state: { data?: WireDays; error?: string } }) {
  const data = state.data;
  if (!data) return <Status error={state.error} />;
  const { totals } = data;
  const perDay = daysBetween(data.from, data.to).map((day) => {
    const models = data.models.filter((row) => row.day === day);
    const bots = data.days.filter((row) => row.day === day);
    const sum = <T,>(rows: readonly T[], of: (row: T) => number) =>
      rows.reduce((t, r) => t + of(r), 0);
    const conversations = sum(bots, (r) => r.conversations);
    const handoffs = sum(bots, (r) => r.handoffs);
    return {
      day,
      turns: sum(models, (r) => r.turns),
      cost: sum(models, (r) => r.cost ?? 0),
      unanswered: sum(models, (r) => r.unanswered),
      conversations,
      up: sum(bots, (r) => r.up),
      down: sum(bots, (r) => r.down),
      leads: sum(bots, (r) => r.leads),
      handoffs,
      resolution:
        conversations === 0 ? null : Math.min(1, Math.max(0, 1 - handoffs / conversations)),
    };
  });
  const maxCost = Math.max(...perDay.map((row) => row.cost), 0);
  const byModel = new Map<
    string,
    { bot: string; model: string; turns: number; tokens: WireTokens; cost: number | null }
  >();
  for (const row of data.models) {
    const id = `${row.bot}\u0000${row.model}`;
    const into = byModel.get(id);
    if (into) {
      into.turns += row.turns;
      into.tokens = {
        input: into.tokens.input + row.tokens.input,
        cachedInput: into.tokens.cachedInput + row.tokens.cachedInput,
        output: into.tokens.output + row.tokens.output,
      };
      into.cost = into.cost === null || row.cost === null ? null : into.cost + row.cost;
    } else {
      byModel.set(id, {
        bot: row.bot,
        model: row.model,
        turns: row.turns,
        tokens: row.tokens,
        cost: row.cost,
      });
    }
  }

  return (
    <section>
      <div class="ad-tiles">
        <Tile
          label="Cost"
          value={formatCost(totals.cost)}
          {...(totals.unpriced.length > 0
            ? { hint: `no price: ${totals.unpriced.join(', ')}` }
            : {})}
        />
        <Tile label="New conversations" value={formatInteger(totals.conversations)} />
        <Tile
          label="Turns"
          value={formatInteger(totals.turns)}
          hint={`${formatInteger(totals.failed)} failed`}
        />
        <Tile
          label="Ratings"
          value={`👍 ${formatInteger(totals.up)} · 👎 ${formatInteger(totals.down)}`}
        />
        <Tile
          label="Unanswered questions"
          value={formatInteger(totals.unanswered)}
          hint="Heuristic: no sources, withheld or failed"
        />
        <Tile label="Leads" value={formatInteger(totals.leads)} />
        <Tile label="Handoffs" value={formatInteger(totals.handoffs)} />
        <Tile
          label="Resolution rate"
          value={formatRate(totals.resolution)}
          hint="New conversations without a handoff"
        />
      </div>

      <h3>By day</h3>
      <div class="ad-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Cost</th>
              <th scope="col">Conversations</th>
              <th scope="col">Turns</th>
              <th scope="col">👍</th>
              <th scope="col">👎</th>
              <th scope="col">Unanswered</th>
              <th scope="col">Leads</th>
              <th scope="col">Handoffs</th>
              <th scope="col">Resolution</th>
            </tr>
          </thead>
          <tbody>
            {perDay
              .slice()
              .reverse()
              .map((row) => (
                <tr key={row.day}>
                  <th scope="row">{row.day}</th>
                  <td>
                    <span class="ad-bar-cell">
                      <span
                        class="ad-bar-fill"
                        style={{ width: `${maxCost > 0 ? (row.cost / maxCost) * 100 : 0}%` }}
                      />
                      <span>{formatCost(row.cost)}</span>
                    </span>
                  </td>
                  <td>{formatInteger(row.conversations)}</td>
                  <td>{formatInteger(row.turns)}</td>
                  <td>{formatInteger(row.up)}</td>
                  <td>{formatInteger(row.down)}</td>
                  <td>{formatInteger(row.unanswered)}</td>
                  <td>{formatInteger(row.leads)}</td>
                  <td>{formatInteger(row.handoffs)}</td>
                  <td>{formatRate(row.resolution)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <h3>By bot and model</h3>
      <div class="ad-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Bot</th>
              <th scope="col">Model</th>
              <th scope="col">Turns</th>
              <th scope="col">Input tokens</th>
              <th scope="col">Cached</th>
              <th scope="col">Output tokens</th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {[...byModel.values()].map((row) => (
              <tr key={`${row.bot}\u0000${row.model}`}>
                <td>{row.bot}</td>
                <td>{row.model}</td>
                <td>{formatInteger(row.turns)}</td>
                <td>{formatInteger(row.tokens.input)}</td>
                <td>{formatInteger(row.tokens.cachedInput)}</td>
                <td>{formatInteger(row.tokens.output)}</td>
                <td>{formatCost(row.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** A list the store pages through: the first page loads with the filter, "More" appends. */
function usePaged<T>(host: DashboardHost, action: string, input: Record<string, unknown>) {
  const key = JSON.stringify(input);
  const first = useQuery<WirePage<T>>(host, action, input, key);
  const [more, setMore] = useState<{
    items: readonly T[];
    cursor?: string | undefined;
    key: string;
  }>();
  const [error, setError] = useState<string>();
  const current = more?.key === key ? more : undefined;
  const items = [...(first.data?.items ?? []), ...(current?.items ?? [])];
  const cursor = current ? current.cursor : first.data?.cursor;
  const loadMore = () =>
    host.call(action, { ...input, cursor }).then(
      (data) => {
        const page = data as WirePage<T>;
        setMore({ items: [...(current?.items ?? []), ...page.items], cursor: page.cursor, key });
      },
      (reason: unknown) => setError(reason instanceof Error ? reason.message : 'internal_error'),
    );
  return { loaded: first.data !== undefined, error: first.error ?? error, items, cursor, loadMore };
}

interface ListProps {
  readonly host: DashboardHost;
  readonly filter: Filter;
  readonly onReview: (ref: string) => void;
}

function Conversations({ host, filter, onReview }: ListProps) {
  const [order, setOrder] = useState<'tokens' | 'latest'>('tokens');
  const list = usePaged<WireConversation>(host, 'conversations', { ...filter, order });
  return (
    <section>
      <label>
        Order{' '}
        <select
          value={order}
          onChange={(event) => setOrder(event.currentTarget.value as 'tokens' | 'latest')}
        >
          <option value="tokens">Most expensive first</option>
          <option value="latest">Latest first</option>
        </select>
      </label>
      {!list.loaded ? (
        <Status error={list.error} />
      ) : list.items.length === 0 ? (
        <p class="ad-muted">No conversations started in this range.</p>
      ) : (
        <div class="ad-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Bot</th>
                <th scope="col">Turns</th>
                <th scope="col">Tokens</th>
                <th scope="col">Cost</th>
                <th scope="col">👍 / 👎</th>
                <th scope="col">
                  <span class="ad-hidden">Review</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => (
                <tr key={item.ref}>
                  <td>{formatTime(item.firstAt)}</td>
                  <td>{item.bot}</td>
                  <td>{formatInteger(item.turns)}</td>
                  <td>{formatInteger(tokenSum(item.tokens))}</td>
                  <td>{item.cost === null ? 'no price' : `≈ ${formatCost(item.cost)}`}</td>
                  <td>
                    {formatInteger(item.up)} / {formatInteger(item.down)}
                  </td>
                  <td>
                    <ReviewButton host={host} item={item} onReview={onReview} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <More list={list} />
    </section>
  );
}

function ReviewButton({
  host,
  item,
  onReview,
}: {
  host: DashboardHost;
  item: { ref: string; transcript?: boolean };
  onReview: (ref: string) => void;
}) {
  if (item.transcript === false && !host.review) return null;
  return (
    <button
      type="button"
      onClick={() =>
        item.transcript === false && host.review ? host.review(item.ref) : onReview(item.ref)
      }
    >
      Review
    </button>
  );
}

function More({
  list,
}: {
  list: {
    cursor?: string | undefined;
    error?: string | undefined;
    loadMore: () => void;
    loaded: boolean;
  };
}) {
  return (
    <>
      {list.loaded && list.error ? <Status error={list.error} /> : null}
      {list.loaded && list.cursor ? (
        <button type="button" class="ad-more" onClick={list.loadMore}>
          More
        </button>
      ) : null}
    </>
  );
}

function Ratings({ host, filter, onReview }: ListProps) {
  const list = usePaged<WireRating>(host, 'ratings', { ...filter, rating: 'down' });
  return (
    <section>
      {!list.loaded ? (
        <Status error={list.error} />
      ) : list.items.length === 0 ? (
        <p class="ad-muted">No 👎 answers in this range.</p>
      ) : (
        <ul class="ad-list">
          {list.items.map((item) => (
            <li key={`${item.ref}${item.at}`}>
              <div class="ad-row">
                <span class="ad-muted">
                  {formatTime(item.at)} · {item.bot}
                </span>
                <ReviewButton host={host} item={item} onReview={onReview} />
              </div>
              <p class="ad-text">{item.comment ?? <span class="ad-muted">No comment</span>}</p>
            </li>
          ))}
        </ul>
      )}
      <More list={list} />
    </section>
  );
}

function Review({
  host,
  reference,
  onBack,
}: {
  host: DashboardHost;
  reference: string;
  onBack: () => void;
}) {
  const state = useQuery<WireTranscript>(host, 'transcript', { ref: reference }, reference);
  return (
    <section>
      <button type="button" onClick={onBack}>
        ← Back
      </button>
      {!state.data ? (
        <Status error={state.error} />
      ) : state.data.turns.length === 0 ? (
        <p class="ad-muted">
          No transcript is stored for this conversation.{' '}
          {host.review ? (
            <button type="button" onClick={() => host.review?.(reference)}>
              Open it from the conversation store
            </button>
          ) : null}
        </p>
      ) : (
        <ol class="ad-list">
          {state.data.turns.map((turn) => (
            <li key={turn.at}>
              <p class="ad-muted">{formatTime(turn.at)}</p>
              <p class="ad-text ad-visitor">
                {turn.input}
                {turn.attachments > 0 ? (
                  <small class="ad-muted"> ({turn.attachments} attached)</small>
                ) : null}
              </p>
              <p class="ad-text">
                {turn.answer ?? <span class="ad-muted">No answer ({turn.reason})</span>}
              </p>
              {turn.check && turn.check !== 'allowed' ? (
                <p class="ad-muted">Output check: {turn.check}</p>
              ) : null}
              {turn.citations.length > 0 ? (
                <ul class="ad-sources">
                  {turn.citations.map((citation) => (
                    <li key={citation.index}>
                      [{citation.index}] {citation.title}
                      {citation.url ? <span class="ad-muted"> {citation.url}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
