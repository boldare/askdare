// A user's page with the chat inside it, as far as the published types go (ADR-0011).
import { defineBot, defineTool } from '@boldare/askdare';
import { EmbedRoot } from '@boldare/askdare/embed';
import { type ChatConfig, type EmbedChatConfig, getChatConfig } from '@boldare/askdare/next';
import * as Chat from '@boldare/askdare/react';
import { type ReactElement, useRef } from 'react';
import { z } from 'zod';

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

// Tool cards (ADR-0017): components typed from the tool with `import type`-style types only.
const findSlots = defineTool({
  name: 'find_slots',
  description: 'Free slots.',
  input: z.object({ day: z.string() }),
  execute: () => ({ slots: [{ at: '9:00', seats: 2 }], cost: 3 }),
  ui: (result) => ({ slots: result.slots.map((slot) => slot.at) }),
});

function SlotList({ data, name, callId }: Chat.ToolRendererProps<typeof findSlots>): ReactElement {
  const slots: string[] = data.slots;
  const tool: 'find_slots' = name;
  return (
    <Chat.Link href={`https://example.com/book/${callId}`}>
      {tool}: {slots.join(', ')}
    </Chat.Link>
  );
}

function WrongCard({ data }: { readonly data: { readonly price: number } }): ReactElement {
  return <p>{data.price}</p>;
}

// Without the tool's type, any name and `data: unknown`, which the component checks itself.
function Untyped({ data, name }: Chat.ToolRendererProps): ReactElement {
  const label: string = name;
  return <p>{typeof data === 'string' ? data : label}</p>;
}

export const renderers = { find_slots: SlotList } satisfies Chat.ToolRenderers<[typeof findSlots]>;
// @ts-expect-error a component for another payload
export const wrong = { find_slots: WrongCard } satisfies Chat.ToolRenderers<[typeof findSlots]>;
// @ts-expect-error a tool the list doesn't have
export const unknownTool = { book_slot: SlotList } satisfies Chat.ToolRenderers<[typeof findSlots]>;

export function WithCards(): ReactElement {
  const ui: readonly Chat.ToolUi[] | undefined = Chat.useMessage().ui;
  return (
    <Chat.Root config={config} toolRenderers={{ ...renderers, other_tool: Untyped }}>
      <Chat.MessageList>
        <Chat.ToolResults className={ui ? 'cards' : undefined} />
      </Chat.MessageList>
      <Chat.DefaultChat />
    </Chat.Root>
  );
}

// The page at a bot's embedPath (ADR-0018).
export function Framed({ embed }: { readonly embed: EmbedChatConfig }): ReactElement {
  return (
    <EmbedRoot config={embed} toolRenderers={renderers}>
      <Chat.DefaultChat className="framed" />
    </EmbedRoot>
  );
}

export function NotAnEmbedConfig(): ReactElement {
  // @ts-expect-error getChatConfig's config lacks the allowed origins and the mode
  return <EmbedRoot config={config} />;
}
