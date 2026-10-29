import { type BotContext, type BotDefinition, defineBot } from '@boldare/chatdock';
import { currentTime, exchangeRate } from './tools';

// Origins allowed to embed the widget, comma-separated (the app's own origin is always allowed).
const vectorStoreId = process.env.KB_VECTOR_STORE_ID;
const allowedOrigins = (process.env.CHATDOCK_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/** Everything but the look: the same assistant behind every theme of the demo page. */
const assistant = {
  // The library never assumes a model; pick a current one for your project.
  model: process.env.CHATDOCK_MODEL ?? 'gpt-6.1-terra',
  instructions: ({ locale }: BotContext) =>
    [
      'You are the website assistant of Brightloop, a fictional project management app.',
      'Answer briefly and politely. If you do not know something, say so.',
      'Answer questions about Brightloop only from the documents you can search, and cite them.',
      'Use the tools for the current time and for exchange rates; never guess them.',
      `Reply in the language of the user's message; default to ${locale}.`,
    ].join(' '),
  tools: [currentTime, exchangeRate],
  // Pages may describe themselves with chatdock('configure', { context }); see docs/styling.md.
  pageContext: true,
  // Documents from knowledge/, uploaded with `pnpm kb:sync`. Without the ID the bot has none.
  knowledge: vectorStoreId ? { vectorStoreId } : undefined,
  // Images and PDFs, up to 4 MB and 3 per message; they expire after 30 days.
  attachments: {},
  // Dictation: speech is transcribed into the message field, up to 60 seconds.
  voice: { model: process.env.CHATDOCK_TRANSCRIBE_MODEL ?? 'gpt-transcribe' },
  security: { allowedOrigins },
} satisfies Omit<BotDefinition, 'id'>;

const starters = [
  'What does the Business plan include?',
  'What are your support hours?',
  'Where is our data stored?',
];

export const bots = [
  defineBot({
    ...assistant,
    id: 'support',
    widget: {
      // The language of the page that embeds the chat; English and Polish texts are built in.
      locale: 'auto',
      // The demo page is light, so its chat is too; /gallery shows the dark schemes.
      colorScheme: 'light',
      title: 'Brightloop assistant',
      subtitle: 'Answers from our help center',
      // **Bold** words get the heavier weight of Aura's two-weight headline.
      greeting: 'Ask me about **Brightloop plans**, support or **security**',
      starters,
      // aura, halo, sage or care; the home page switches between the bots below.
      theme: 'aura',
    },
  }),
  // The same assistant in the other themes, for the theme switch on the demo page.
  defineBot({
    ...assistant,
    id: 'sage',
    widget: {
      locale: 'auto',
      colorScheme: 'light',
      title: 'Ola from Brightloop',
      subtitle: 'Your Brightloop guide',
      greeting: "I'm here whenever you need me. Let's find the right plan for your team.",
      starters,
      launcherLabel: 'Chat with Ola',
      theme: 'sage',
    },
  }),
  defineBot({
    ...assistant,
    id: 'halo',
    widget: {
      locale: 'auto',
      colorScheme: 'light',
      title: 'Brightloop AI',
      subtitle: 'Answers from our help center',
      greeting: 'What can I help you with today?',
      starters,
      theme: 'halo',
    },
  }),
  defineBot({
    ...assistant,
    id: 'care',
    widget: {
      locale: 'auto',
      colorScheme: 'light',
      title: 'Brightloop help',
      subtitle: 'Support, plans and security',
      greeting: 'Hello! I can help you with:',
      starters,
      theme: 'care',
    },
  }),
];

/** Bot behind each theme of the demo page. */
export const DEMO_BOTS = { aura: 'support', sage: 'sage', halo: 'halo', care: 'care' } as const;
