import type { Metadata } from 'next';
import { IBM_Plex_Mono, Sora } from 'next/font/google';
import './globals.css';
import './v2.css';
import './orion-royal.css';
import './orion-command.css';

const display = Sora({
  variable: '--font-display',
  subsets: ['latin'],
  display: 'swap'
});

const mono = IBM_Plex_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap'
});

export const metadata: Metadata = {
  title: {
    default: 'Orion Control Center',
    template: '%s | Orion Scalper'
  },
  description: 'Secure Orion administration and client access.',
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
