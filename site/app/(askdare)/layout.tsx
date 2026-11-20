import './frame.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Brightloop assistant',
  // A page for the widget's iframe only.
  robots: { index: false, follow: false },
};

/**
 * The root layout of the pages bots show in the widget's iframe (ADR-0018): its own, so nothing of
 * the site (navigation, fonts, scripts) renders or runs inside the widget on other sites.
 */
export default function FrameLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
