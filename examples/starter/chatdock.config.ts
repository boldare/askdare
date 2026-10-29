import { defineBot } from '@boldare/chatdock';

// Origins allowed to embed the widget, comma-separated (the app's own origin is always allowed).
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
        'You are the website assistant of an example company.',
        'Answer briefly and politely. If you do not know something, say so.',
        `Reply in the language of the user's message; default to ${locale}.`,
      ].join(' '),
    security: { allowedOrigins },
    widget: {
      title: 'chatdock demo',
      greeting: 'Hi! Ask me anything about this demo.',
    },
  }),
];
