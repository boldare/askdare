'use client';

import * as Chat from '@boldare/askdare/react';

function Heading() {
  const { bot, state, actions } = Chat.useChat();
  return (
    <header>
      <strong>{bot.title}</strong>{' '}
      {state.messages.length > 0 && (
        <button type="button" disabled={state.busy} onClick={() => void actions.newConversation()}>
          Start over
        </button>
      )}
      {state.messages.length === 0 && state.phase === 'ready' && <p>{bot.greeting}</p>}
    </header>
  );
}

function Bubble() {
  const message = Chat.useMessage();
  return (
    <Chat.Message>
      <small>{message.role === 'user' ? 'You' : 'Assistant'}</small>
      <Chat.MessageText />
      <Chat.Citations />
    </Chat.Message>
  );
}

/** No theme and no default look: the page's CSS styles the parts. */
export function PlainChat({ config }: { readonly config: Chat.ChatConfig }) {
  return (
    <Chat.Root config={config} greeting="Ask in your own markup">
      <Chat.Panel className="plain-chat">
        <Heading />
        <Chat.Messages>
          <Chat.MessageList>
            <Bubble />
          </Chat.MessageList>
          <Chat.Status />
        </Chat.Messages>
        <Chat.ErrorMessage />
        <Chat.Composer>
          <Chat.Input />
          <Chat.Send>Send</Chat.Send>
        </Chat.Composer>
      </Chat.Panel>
    </Chat.Root>
  );
}
