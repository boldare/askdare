'use client';

import './events.css';
import * as Chat from '@boldare/askdare/react';
import { type RefObject, useEffect, useId, useRef, useState } from 'react';

interface Logged {
  readonly id: number;
  readonly at: Date;
  readonly event: Chat.ChatEvent;
}

const time = (at: Date): string =>
  at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** True once the element comes within a screen of the viewport, and from then on. */
function useNear(enabled: boolean): [RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(!enabled);
  useEffect(() => {
    const element = ref.current;
    if (near || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: '100% 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near];
}

export interface EventsDemoProps {
  readonly config: Chat.ChatConfig;
  /** The element that sizes the chat; the panel beside it takes the same height. */
  readonly chatClassName: string;
  readonly className?: string | undefined;
  /** This page's greeting and suggested questions, instead of the bot's. */
  readonly greeting?: string | undefined;
  readonly starters?: readonly string[] | undefined;
  /** Start the chat only when it scrolls near, so a page that has it lower down opens no session. */
  readonly lazy?: boolean | undefined;
}

/**
 * The default look with every event `onEvent` hands the page listed beside it (ADR-0013). Each
 * entry shows all of the event's fields, so you can see that none of them is what anyone wrote.
 */
export function EventsDemo({
  config,
  chatClassName,
  className = 'inline-demo',
  greeting,
  starters,
  lazy = false,
}: EventsDemoProps) {
  const [events, setEvents] = useState<readonly Logged[]>([]);
  const next = useRef(0);
  const titleId = useId();
  const [slot, near] = useNear(lazy);
  const log = (event: Chat.ChatEvent): void => {
    const id = next.current++;
    setEvents((list) => [{ id, at: new Date(), event }, ...list]);
  };

  return (
    <div className={className}>
      {near ? (
        <Chat.Root config={config} onEvent={log} greeting={greeting} starters={starters}>
          <Chat.DefaultChat className={chatClassName} />
        </Chat.Root>
      ) : (
        <div ref={slot} className={chatClassName} aria-hidden="true" />
      )}
      <aside className="events" aria-labelledby={titleId}>
        <header>
          <h2 id={titleId}>Chat events</h2>
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
              <li
                key={id}
                data-type={type}
                data-source={'source' in event ? event.source : undefined}
              >
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
