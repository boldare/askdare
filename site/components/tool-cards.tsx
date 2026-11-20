'use client';

import './tool-cards.css';
import * as Chat from '@boldare/askdare/react';
import type { ReactElement } from 'react';
// Types only: the tools run on the server and never reach this bundle.
import type { currentTime, exchangeRate } from '@/tools';

/** The current time a tool looked up, as a card under the answer (ADR-0017). */
function TimeCard({ data }: Chat.ToolRendererProps<typeof currentTime>): ReactElement {
  const { actions } = Chat.useChat();
  return (
    <figure className="tool-card">
      <figcaption>{data.timeZone.replaceAll('_', ' ')}</figcaption>
      <p className="tool-card-value" data-card-time="">
        {data.now}
      </p>
      {data.timeZone !== 'UTC' && (
        <p className="tool-card-actions">
          {/* A click is the visitor's own message, exactly as if they had typed it. */}
          <button type="button" onClick={() => void actions.send('And in UTC?')}>
            Compare with UTC
          </button>
        </p>
      )}
    </figure>
  );
}

/** An exchange rate, with a link to its source that `Chat.Link` checks like links in answers. */
function RateCard({ data }: Chat.ToolRendererProps<typeof exchangeRate>): ReactElement {
  const { actions } = Chat.useChat();
  return (
    <figure className="tool-card">
      <figcaption>
        {data.base} → {data.quote} · ECB, {data.date}
      </figcaption>
      <p className="tool-card-value">
        1 {data.base} = {data.rate} {data.quote}
      </p>
      <p className="tool-card-actions">
        {/* A click is the visitor's own message, exactly as if they had typed it. */}
        <button
          type="button"
          onClick={() => void actions.send(`And ${data.quote} to ${data.base}?`)}
        >
          Reverse
        </button>
        <Chat.Link href="https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html">
          Source
        </Chat.Link>
      </p>
    </figure>
  );
}

/** The site's components for its tools, checked against what each tool's `ui` returns. */
export const toolRenderers = {
  get_current_time: TimeCard,
  get_exchange_rate: RateCard,
} satisfies Chat.ToolRenderers<[typeof currentTime, typeof exchangeRate]>;
