import { defineBot } from '@boldare/askdare';

export const bots = [
  defineBot({
    id: 'support',
    // Required: a current OpenAI model your project may use. Set ASKDARE_MODEL in .env.local.
    model: process.env.ASKDARE_MODEL ?? '',
    instructions: ({ locale }) =>
      [
        'You are the assistant on our website. Answer briefly and politely.',
        'If you do not know something, say so.',
        `Reply in the language of the visitor's message; default to ${locale}.`,
      ].join(' '),
    security: {
      // Other sites that may embed the chat, e.g. ['https://www.example.com'].
      allowedOrigins: [],
    },
    widget: {
      locale: 'auto',
      greeting: 'Hi! How can I help?',
      theme: 'aura', // aura, halo, sage or care
    },
    // Knowledge base, tools, attachments, voice and limits: see node_modules/@boldare/askdare/docs.
  }),
];
