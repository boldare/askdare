import type { GalleryState } from '../server/embed-page';
import type { Fixture, Message } from './app';

/** A small landscape, as a stand-in for a visitor's photo (an <img> never runs SVG scripts). */
const PHOTO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="s" x2="0" y2="1"><stop offset="0" stop-color="#9cc9ff"/><stop offset="1" stop-color="#fde2c4"/></linearGradient></defs><rect width="40" height="40" fill="url(#s)"/><circle cx="29" cy="12" r="5" fill="#fff6d5"/><path d="M0 30l11-11 9 9 6-5 14 12v5H0z" fill="#4f7d6a"/></svg>',
)}`;

const message = (
  id: string,
  role: Message['role'],
  text: string,
  extra: Partial<Message> = {},
): Message => ({ id, role, text, citations: [], attachments: 0, status: 'done', ...extra });

const conversation: readonly Message[] = [
  message('u1', 'user', 'What does the Business plan include?'),
  message(
    'a1',
    'assistant',
    [
      'The **Business** plan is built for larger teams:',
      '',
      '- Unlimited users and **1 TB** of storage',
      '- Single sign-on with SAML and an audit log',
      '- Priority support, first reply within 4 business hours',
      '',
      '| Billing | Price per user |',
      '| --- | --- |',
      '| Monthly | €15 |',
      '| Yearly | €12 |',
    ].join('\n'),
    {
      citations: [
        { index: 1, title: 'Brightloop pricing and plans', url: 'https://example.com/pricing' },
        { index: 2, title: 'Brightloop security and privacy', url: 'https://example.com/security' },
      ],
    },
  ),
  message('u2', 'user', 'Can we try it first?'),
  message(
    'a2',
    'assistant',
    'Yes. Every paid plan starts with a **14-day free trial**, and you don’t need a card to start it.',
  ),
];

/** Every state a theme has to look right in. */
export const FIXTURES: Readonly<Record<GalleryState, Fixture>> = {
  welcome: { messages: [] },
  conversation: { messages: conversation },
  streaming: {
    messages: [
      ...conversation.slice(0, 2),
      message('u2', 'user', 'How do I move our projects from Trello?'),
      message(
        'a2',
        'assistant',
        'Go to **Settings → Import** and choose Trello. Brightloop brings over',
        {
          status: 'streaming',
        },
      ),
    ],
    busy: true,
  },
  attachments: {
    messages: [
      message('u1', 'user', 'Is this the right screen for exporting?', {
        attachments: 2,
        files: [
          { name: 'screenshot.jpg', kind: 'image', previewUrl: PHOTO },
          { name: 'export-guide.pdf', kind: 'pdf' },
        ],
      }),
      message('a1', 'assistant', '', { status: 'streaming' }),
    ],
    pending: [
      { key: 'p1', name: 'invoice-march.pdf', kind: 'pdf', status: 'ready', handle: 'h' },
      { key: 'p2', name: 'team-photo.jpg', kind: 'image', status: 'uploading', previewUrl: PHOTO },
      { key: 'p3', name: 'notes.svg', status: 'error', error: 'This file type is not supported.' },
    ],
    busy: true,
    activity: 'Searching documents…',
  },
  error: {
    messages: [
      ...conversation.slice(0, 2),
      message('u2', 'user', 'And the Enterprise plan?'),
      message('a2', 'assistant', 'Enterprise adds', { status: 'error' }),
    ],
    error: 'The assistant took too long to respond. Please try again.',
    draft: 'And the Enterprise plan?',
  },
  listening: { messages: conversation.slice(0, 2), dictation: 'recording', elapsed: 7 },
};
