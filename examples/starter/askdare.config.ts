import { defineBot } from '@boldare/askdare';

// Other sites that may embed the chat, comma-separated, e.g. https://www.example.com.
const allowedOrigins = (process.env.ASKDARE_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const bots = [
  defineBot({
    id: 'support',
    // Required: a current OpenAI model your project may use. Set ASKDARE_MODEL in .env.local.
    model: process.env.ASKDARE_MODEL ?? '',
    // ASKDARE_INSTRUCTIONS and ASKDARE_GREETING are optional and replace the defaults below.
    instructions: ({ locale }) =>
      [
        process.env.ASKDARE_INSTRUCTIONS ||
          'You are the assistant on our website. Answer briefly and politely. If you do not know something, say so.',
        `Reply in the language of the visitor's message; default to ${locale}.`,
      ].join(' '),
    security: { allowedOrigins },
    widget: {
      locale: 'auto',
      greeting: process.env.ASKDARE_GREETING || 'Hi! How can I help?',
      theme: 'aura', // aura, halo, sage or care
    },
    // Knowledge base, tools, attachments, voice and limits: see node_modules/@boldare/askdare/docs.
  }),
];
