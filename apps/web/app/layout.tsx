import type { Metadata } from 'next';
import { Inter, Inter_Tight } from 'next/font/google';
import { ConnectionStatus } from '@/components/connection-status';
import './globals.css';

// Every Klinika app route reads cookies, headers, or per-request
// query string state (auth context, clinic resolution, search
// params on /receptionist, /pacientet, /admin, …). Forcing dynamic
// at the root layout opts the whole tree out of build-time
// prerendering — pages are rendered per-request on the server.
// Without this, `next build` errors with "useSearchParams should be
// wrapped in a suspense boundary" on the dashboard routes.
export const dynamic = 'force-dynamic';

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
});

const interDisplay = Inter_Tight({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Klinika',
  description: 'Klinika',
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
    noimageindex: true,
    notranslate: true,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      'max-video-preview': -1,
      'max-image-preview': 'none',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="sq" className={`${inter.variable} ${interDisplay.variable}`}>
      <body className="font-sans">
        {children}
        <ConnectionStatus />
      </body>
    </html>
  );
}
