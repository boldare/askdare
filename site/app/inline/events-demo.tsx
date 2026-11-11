'use client';

import * as Chat from '@boldare/askdare/react';
import { useRef, useState } from 'react';

interface Logged {
  readonly id: number;
  readonly at: Date;
  readonly event: Chat.ChatEvent;
}

const time = (at: Date): string =>
  at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * The default look with every event `onEvent` hands the page listed beside it (ADR-0013). Each
 * entry shows all of the event's fields, so you can see that none of them is what anyone wrote.
 */
export function EventsDemo({ config }: { readonly config: Chat.ChatConfig }) {
  const [events, setEvents] = useState<readonly Logged[]>([]);
  const next = useRef(0);
  const log = (event: Chat.ChatEvent): void => {
    const id = next.current++;
    setEvents((list) => [{ id, at: new Date(), event }, ...list]);
  };

  return (
    <div className="inline-demo">
      <Chat.Root config={config} onEvent={log}>
        <Chat.DefaultChat className="inline-chat" />
      </Chat.Root>
      <aside className="events" aria-labelledby="events-title">
        <header>
          <h2 id="events-title">Chat events</h2>
          <button type="button" disabled={events.length === 0} onClick={() => setEvents([])}>
            Clear
          </button>
        </header>
        <p>
          What <code>&lt;Root onEvent&gt;</code> hands this page, newest first. Counts, durations
          and outcomes, never the text. <a href="/docs/events">Chat events in the docs</a>
        </p>
        {events.length === 0 && <p className="events-empty">Nothing yet. Ask the assistant.</p>}
        <ol className="events-list" aria-label="Events, newest first">
          {events.map(({ id, at, event }) => {
            const { type, ...fields } = event;
            return (
              <li key={id} data-type={type}>
                <code className="events-type">{type}</code>
                <time dateTime={at.toISOString()}>{time(at)}</time>
                <dl>
                  {Object.entries(fields).map(([name, value]) => (
                    <div key={name}>
                      <dt>{name}</dt>
                      <dd>{JSON.stringify(value)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ol>
      </aside>
    </div>
  );
}
