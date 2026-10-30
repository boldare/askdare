import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'askdare starter',
  description: 'A Next.js app with an AI chat from askdare.',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Script src="/api/chat/widget.js?bot=support" strategy="afterInteractive" />
      </body>
    </html>
  );
}
