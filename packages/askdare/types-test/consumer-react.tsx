// A user's page with the chat inside it, as far as the published types go (ADR-0011).
import { defineBot } from '@boldare/askdare';
import { type ChatConfig, getChatConfig } from '@boldare/askdare/next';
import * as Chat from '@boldare/askdare/react';
import { type ReactElement, useRef } from 'react';

const bots = [defineBot({ id: 'support', model: 'a-current-model', instructions: 'Be brief.' })];

export const config: ChatConfig = getChatConfig({ bots, bot: 'support', locale: 'pl' });

export function Ready({ token }: { readonly token: string | null }): ReactElement {
  return (
    <Chat.Root config={config} identity={token} context="Pricing page" starters={['How much?']}>
      <Chat.DefaultChat
        className="chat"
        headingLevel={3}
        colorScheme="dark"
        onClose={() => {}}
        components={{ Header: MyHeader }}
      />
    </Chat.Root>
  );
}

function MyHeader(): ReactElement {
  const { bot, state, actions, t } = Chat.useChat();
  const busy: boolean = Chat.useChatState((chat) => chat.busy);
  return (
    <button type="button" disabled={busy} onClick={() => void actions.newConversation()}>
      {bot.title} · {state.messages.length} · {t('header.newConversation')}
    </button>
  );
}

function Bubble(): ReactElement {
  const message: Chat.ChatMessage = Chat.useMessage();
  return (
    <Chat.Message className={message.role}>
      <Chat.MessageText />
      <Chat.MessageFiles />
      <Chat.Citations />
    </Chat.Message>
  );
}

export function Headless(): ReactElement {
  const field = useRef<HTMLTextAreaElement>(null);
  return (
    <Chat.Root config={config}>
      <Chat.Theme style={{ height: 600 }}>
        <Chat.Panel>
          <Chat.Messages>
            <Chat.MessageList>
              <Bubble />
            </Chat.MessageList>
            <Chat.Status />
          </Chat.Messages>
          <Chat.ErrorMessage />
          <Chat.Composer>
            <Chat.Files />
            <Chat.AttachButton>Attach</Chat.AttachButton>
            <Chat.Input ref={field} />
            <Chat.DictateButton>Dictate</Chat.DictateButton>
            <Chat.Recorder />
            <Chat.Send>Send</Chat.Send>
          </Chat.Composer>
        </Chat.Panel>
      </Chat.Theme>
    </Chat.Root>
  );
}
