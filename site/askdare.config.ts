import { type BotContext, type BotDefinition, defineBot, defineTheme } from '@boldare/askdare';
import { currentTime, exchangeRate } from './tools';

// Origins allowed to embed the widget, comma-separated (the app's own origin is always allowed).
const vectorStoreId = process.env.KB_VECTOR_STORE_ID;
const allowedOrigins = (process.env.ASKDARE_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

/** Everything but the look: the same assistant behind every theme of the demo page. */
const assistant = {
  // The library never assumes a model; pick a current one for your project.
  model: process.env.ASKDARE_MODEL ?? 'gpt-6.1-terra',
  instructions: ({ locale, identity }: BotContext) =>
    [
      'You are the website assistant of Brightloop, a fictional project management app.',
      // Only ever verified: set with askdare('identify') and checked with IDENTITY_SECRET.
      identity ? `The visitor is signed in as "${identity.name ?? identity.id}".` : '',
      'Answer briefly and politely. If you do not know something, say so.',
      'Answer questions about Brightloop only from the documents you can search, and cite them.',
      'Use the tools for the current time and for exchange rates; never guess them.',
      `Reply in the language of the user's message; default to ${locale}.`,
    ]
      .filter(Boolean)
      .join(' '),
  tools: [currentTime, exchangeRate],
  // Pages may describe themselves with askdare('configure', { context }); see docs/styling.md.
  pageContext: true,
  // Documents from knowledge/, uploaded with `pnpm kb:sync`. Without the ID the bot has none.
  knowledge: vectorStoreId ? { vectorStoreId } : undefined,
  // Images and PDFs, up to 4 MB and 3 per message; they expire after 30 days.
  attachments: {},
  // Dictation: speech is transcribed into the message field, up to 60 seconds.
  voice: { model: process.env.ASKDARE_TRANSCRIBE_MODEL ?? 'gpt-transcribe' },
  security: { allowedOrigins },
  // Five bots share one OpenAI project: each gets a fifth of the default daily budgets, and
  // the route caps them together (globalDailyTokens).
  limits: { dailyTokens: 400_000, dailyTokensPerIp: 40_000 },
} satisfies Omit<BotDefinition, 'id'>;

/** Brightloop isn't real: the demo says so in each chat's header. */
const DEMO_NOTE = 'Demo · Brightloop is a fictional company';

const starters = [
  'What does the Business plan include?',
  'What are your support hours?',
  'Where is our data stored?',
];

/** boldare.com: ink and light grey, heavy type, sharp corners, yellow with a hard ink shadow. */
const bldr = defineTheme({
  extends: 'halo',
  tokens: {
    accent: '#242424',
    onAccent: '#ffffff',
    background: '#f1f1f1',
    surface: '#ffffff',
    text: '#242424',
    muted: '#4f4f4f',
    border: '#24242433',
    userBubble: '#242424',
    onUserBubble: '#ffffff',
    backdrop: 'none',
    orb: 'radial-gradient(circle at 35% 30%, #fff7c2 0%, #f2da3a 50%, #c4ac12 100%)',
    fontFamily: '"Plus Jakarta Sans Variable", system-ui, sans-serif',
    headingFamily: '"Plus Jakarta Sans Variable", system-ui, sans-serif',
    radius: '0px',
  },
  variants: { avatar: 'initials', launcher: 'pill', surface: 'solid', composer: 'outline' },
});

const BLDR_CSS = `
  [data-ask-part="header"] { background: #242424; color: #fff; border-bottom: 0; }
  [data-ask-part="subtitle"] { color: #c9c9c9; }
  [data-ask-part="header"] button { color: #fff; }
  [data-ask-part="avatar"] { border-radius: 0; background: #f2da3a; color: #242424; font-weight: 800; }
  [data-ask-part="greeting"] { font-weight: 800; letter-spacing: -0.03em; }
  [data-ask-part="greeting"] strong { padding: 0 0.15em; background: #f2da3a; box-decoration-break: clone; }
  [data-ask-part="greeting"]::after {
    content: ""; display: block; width: 32px; height: 4px; margin: 14px auto 0; background: #242424;
  }
  [data-ask-part="starter"] {
    border: 2px solid #242424; border-radius: 0; background: #fff; box-shadow: -4px 4px 0 #242424;
  }
  [data-ask-part="starter"]:hover:not(:disabled) {
    transform: translate(2px, -2px); box-shadow: -6px 6px 0 #242424; border-color: #242424;
  }
  [data-ask-part="starter"] svg { color: #242424; }
  [data-ask-part="message"][data-role="assistant"] [data-ask-part="bubble"] { border: 2px solid #242424; }
  [data-ask-part="composer-box"] { border: 2px solid #242424; border-radius: 0; box-shadow: none; }
  [data-ask-part="send"] {
    border: 2px solid #242424; border-radius: 0; background: #f2da3a; color: #242424;
    box-shadow: -3px 3px 0 #242424;
  }
  /* Buttons press towards their hard shadow, like on boldare.com. */
  :is([data-ask-part="send"], [data-ask-part="confirm-cancel"], [data-ask-part="confirm-accept"]) {
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  }
  :is([data-ask-part="send"], [data-ask-part="confirm-cancel"], [data-ask-part="confirm-accept"]):hover:not(:disabled) {
    transform: translate(2px, -2px); box-shadow: -5px 5px 0 #242424;
  }
  :is([data-ask-part="confirm-cancel"], [data-ask-part="confirm-accept"]) {
    border: 2px solid #242424; box-shadow: -3px 3px 0 #242424;
  }
  [data-ask-part="confirm-accept"], [data-ask-part="confirm-accept"]:hover { background: #f2da3a; color: #242424; }
  :is([data-ask-part="attach"], [data-ask-part="voice"]):hover:not(:disabled) { background: #f2da3a; }
  [data-ask-part="citation"] { border: 2px solid #242424; border-radius: 0; }
  /* Halo, the preset underneath, rings its orb and rounds its buttons: square them off. */
  [data-ask-part="welcome"] [data-ask-part="avatar"][data-size="large"] {
    border: 2px solid #242424; box-shadow: -6px 6px 0 #242424;
  }
  :is([data-ask-part="attach"], [data-ask-part="voice"]) {
    border-radius: 0; background: transparent; color: #242424;
  }
  [data-ask-part="message"][data-role="user"] [data-ask-part="bubble"] { border-radius: 0; }
`;

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
      launcherLabel: 'Ask Brightloop AI',
      // The demo says what it is inside the chat, not on the page.
      subtitle: DEMO_NOTE,
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
      subtitle: DEMO_NOTE,
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
      launcherLabel: 'Ask Brightloop AI',
      subtitle: DEMO_NOTE,
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
      subtitle: DEMO_NOTE,
      greeting: 'Hello! I can help you with:',
      starters,
      theme: 'care',
    },
  }),
  // A custom theme in Boldare's style: a built-in preset adjusted with defineTheme, plus a few
  // lines of widget.css. Nothing a site can't do with its own brand (docs/styling.md).
  defineBot({
    ...assistant,
    id: 'bldr',
    widget: {
      locale: 'auto',
      colorScheme: 'light',
      title: 'Boldare AI',
      subtitle: DEMO_NOTE,
      greeting: 'Your **AI partner** for Brightloop questions',
      starters,
      launcherLabel: 'Ask Boldare',
      theme: bldr,
      css: BLDR_CSS,
    },
  }),
  // The docs answer questions about askdare from docs/ itself, once synced with
  // `node site/scripts/docs-kb.mjs` (DOCS_VECTOR_STORE_ID). The docs pages show it only then.
  defineBot({
    id: 'docs',
    model: process.env.ASKDARE_MODEL ?? 'gpt-6.1-terra',
    instructions: ({ locale }: BotContext) =>
      [
        'You answer questions about askdare, an open source Next.js library for embeddable AI chatbots on the OpenAI API.',
        'Answer only from the askdare documentation you can search, and cite the pages you used.',
        'If the documentation does not cover something, say so and suggest where to look; never invent options, commands or defaults.',
        'Keep answers short, with code only when it helps.',
        `Reply in the language of the user's message; default to ${locale}.`,
      ].join(' '),
    knowledge: process.env.DOCS_VECTOR_STORE_ID
      ? { vectorStoreId: process.env.DOCS_VECTOR_STORE_ID }
      : undefined,
    security: { allowedOrigins },
    limits: { dailyTokens: 400_000, dailyTokensPerIp: 40_000 },
    widget: {
      locale: 'en',
      colorScheme: 'auto',
      title: 'askdare docs',
      launcherLabel: 'Ask the docs',
      greeting: 'Ask me anything about **askdare**',
      starters: [
        'How do I embed the chat on another site?',
        'How do I add a knowledge base?',
        'What does a busy day cost?',
      ],
      theme: 'aura',
    },
  }),
];

/** Bot behind each theme of the demo page. */
export const DEMO_BOTS = {
  aura: 'support',
  sage: 'sage',
  halo: 'halo',
  care: 'care',
  bldr: 'bldr',
} as const;
