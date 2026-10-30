import '@fontsource-variable/plus-jakarta-sans/wght.css';
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
import './demo.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  // Absolute URLs for the link preview, app/opengraph-image.png (site/scripts/readme-images.mjs).
  metadataBase: new URL(process.env['SITE_URL'] ?? 'https://askdare.vercel.app'),
  title: 'askdare: Dare to ask. An AI assistant for any website, by Boldare',
  description:
    'An embeddable AI chatbot for Next.js, built on the official OpenAI SDK. One route, one script tag, four themes.',
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
