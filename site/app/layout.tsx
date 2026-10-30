import '@fontsource-variable/plus-jakarta-sans/wght.css';
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
import './demo.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The link preview, rendered by site/scripts/readme-images.mjs. Set here rather than as
// app/opengraph-image.png: Turbopack ignores the opengraph-image.alt.txt beside that file.
const preview = {
  url: '/askdare-og.png',
  width: 1280,
  height: 640,
  alt: 'askdare: an AI assistant for any website, in one script tag. A chat panel answers a question about a pricing plan with a list, a table and two cited sources.',
};

export const metadata: Metadata = {
  // Makes the preview's URL absolute.
  metadataBase: new URL(process.env['SITE_URL'] ?? 'https://askdare.vercel.app'),
  title: 'askdare: Dare to ask. An AI assistant for any website, by Boldare',
  description:
    'An embeddable AI chatbot for Next.js, built on the official OpenAI SDK. One route, one script tag, four themes.',
  openGraph: { type: 'website', siteName: 'askdare', images: [preview] },
  twitter: { card: 'summary_large_image', images: [preview] },
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
