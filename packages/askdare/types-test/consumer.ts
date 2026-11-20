// A user's app, as far as the published types go: type-checked with every supported TypeScript
// version (ADR-0006), against dist/ rather than src/.
import {
  defineBot,
  defineTheme,
  defineTool,
  type Tool,
  type ToolContext,
  type VisitorIdentity,
} from '@boldare/askdare';
import {
  createChatHandler,
  type EmbedChatConfig,
  embedPageHeaders,
  getEmbedConfig,
} from '@boldare/askdare/next';
import { z } from 'zod';

const lookup = defineTool({
  name: 'lookup_order',
  description: 'An order of the signed-in visitor.',
  input: z.object({ orderNumber: z.string(), note: z.string().nullable() }),
  execute: async ({ orderNumber }, context: ToolContext) => ({
    orderNumber,
    owner: context.identity?.id ?? null,
  }),
});

// A tool with a payload for the visitor (ADR-0017): `ui` gets the result as JSON gives it back.
const findSlots = defineTool({
  name: 'find_slots',
  description: 'Free slots on a day.',
  input: z.object({ day: z.string() }),
  execute: () => ({ slots: [{ at: new Date(), seats: 2 }], internal: 'cost-center-7' }),
  ui: (output) => {
    // @ts-expect-error a Date comes back as a string
    const notADate: Date | undefined = output.slots[0]?.at;
    void notADate;
    return { slots: output.slots.map((slot) => ({ at: slot.at, seats: slot.seats })) };
  },
});
// The name stays a literal and the payload keeps its type, for typed renderers in a page.
const named: Tool<'find_slots', { slots: { at: string; seats: number }[] }> = findSlots;
// @ts-expect-error another tool's name
const misnamed: Tool<'book_slot'> = findSlots;
// A tool without `ui` still fits every bot.
const plain: Tool = lookup;
export const typed = { named, misnamed, plain };

const brand = defineTheme({ extends: 'aura', accent: '#6b52e0', variants: { launcher: 'pill' } });

export const bots = [
  defineBot({
    id: 'support',
    model: 'a-current-model',
    instructions: ({ locale, identity }) => `Reply in ${locale}. ${identity?.name ?? ''}`,
    tools: [lookup, findSlots],
    knowledge: { vectorStoreId: 'vs_123' },
    attachments: { images: true },
    widget: {
      theme: brand,
      greeting: 'Ask about **plans**',
      disclosure: { privacyUrl: '/privacy' },
    },
  }),
];

export const { GET, POST, DELETE } = createChatHandler({ bots, gallery: false });

export const nobody: VisitorIdentity | undefined = undefined;

// Your own page in the widget's iframe (ADR-0018).
export const framed = defineBot({
  id: 'framed',
  model: 'a-current-model',
  instructions: 'x',
  embedPath: '/askdare/framed',
});
export const embedConfig: EmbedChatConfig = getEmbedConfig({
  bots: [framed],
  bot: 'framed',
  searchParams: { lang: 'pl', mode: undefined },
});
export const mode: 'floating' | 'inline' = embedConfig.mode;
export const nextHeaders: { key: string; value: string }[] = embedPageHeaders({
  bots: [framed],
  bot: 'framed',
});
