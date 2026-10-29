import { defineBot } from '@boldare/chatdock';
import { currentTime, exchangeRate } from './tools';

// Origins allowed to embed the widget, comma-separated (the app's own origin is always allowed).
const vectorStoreId = process.env.KB_VECTOR_STORE_ID;
const allowedOrigins = (process.env.CHATDOCK_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const bots = [
  defineBot({
    id: 'support',
    // The library never assumes a model; pick a current one for your project.
    model: process.env.CHATDOCK_MODEL ?? 'gpt-6.1-terra',
    instructions: ({ locale }) =>
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
    widget: {
      // The language of the page that embeds the chat; English and Polish texts are built in.
      locale: 'auto',
      title: 'Brightloop assistant',
      subtitle: 'Answers from our help center',
      greeting: 'Hi! Ask me about Brightloop plans, support or security.',
      starters: [
        'What does the Business plan include?',
        'What are your support hours?',
        'Where is our data stored?',
      ],
      // halo, aura, sage or care; CHATDOCK_THEME lets you try them without editing this file.
      theme:
        (process.env.CHATDOCK_THEME as 'halo' | 'aura' | 'sage' | 'care' | undefined) || 'halo',
    },
  }),
];
