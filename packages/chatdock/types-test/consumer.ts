// A user's app, as far as the published types go: type-checked with every supported TypeScript
// version (ADR-0006), against dist/ rather than src/.
import {
  defineBot,
  defineTheme,
  defineTool,
  type ToolContext,
  type VisitorIdentity,
} from '@boldare/chatdock';
import { createChatHandler } from '@boldare/chatdock/next';
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

const brand = defineTheme({ extends: 'aura', accent: '#6b52e0', variants: { launcher: 'pill' } });

export const bots = [
  defineBot({
    id: 'support',
    model: 'a-current-model',
    instructions: ({ locale, identity }) => `Reply in ${locale}. ${identity?.name ?? ''}`,
    tools: [lookup],
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
