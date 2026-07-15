import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Orion Analytics',
  description: 'Private visitor analytics for the Orion Scalper landing page',
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
