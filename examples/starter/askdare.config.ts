import { defineBot } from '@boldare/askdare';

// Other sites that may embed the chat, comma-separated, e.g. https://www.example.com.
const allowedOrigins = (process.env.ASKDARE_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

export const bots = [
  defineBot({
    id: 'support',
    // Required: a current OpenAI model your project may use. Set ASKDARE_MODEL in .env.local.
    model: process.env.ASKDARE_MODEL ?? '',
    // Optional ASKDARE_INSTRUCTIONS and ASKDARE_GREETING replace the defaults below. Where they are
    // set, as after a one-click deploy, change them there: they win over this file.
    instructions: ({ locale }) =>
      [
        process.env.ASKDARE_INSTRUCTIONS?.trim() ||
          'You are the assistant on our website. Answer briefly and politely. If you do not know something, say so.',
        `Reply in the language of the visitor's message; default to ${locale}.`,
      ].join('\n\n'),
    security: { allowedOrigins },
    widget: {
      locale: 'auto',
      greeting: process.env.ASKDARE_GREETING?.trim() || 'Hi! How can I help?',
      theme: 'aura', // aura, halo, sage or care
    },
    // Knowledge base, tools, attachments, voice and limits: see node_modules/@boldare/askdare/docs.
  }),
];
