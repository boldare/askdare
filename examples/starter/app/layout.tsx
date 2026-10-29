import '@fontsource-variable/plus-jakarta-sans/wght.css';
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
import './demo.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'chatdock by Boldare: an AI assistant for any website',
  description:
    'An embeddable AI chatbot for Next.js, built on the official OpenAI SDK. One route, one script tag, four themes.',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
