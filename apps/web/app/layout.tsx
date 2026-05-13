import type { Metadata } from 'next';
import { Inter, Inter_Tight } from 'next/font/google';
import { ConnectionStatus } from '@/components/connection-status';
import './globals.css';

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
