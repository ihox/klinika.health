import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'Klinika · Platform Admin',
    template: '%s · Platform Admin',
  },
  description: 'Panel administrimi i platformës Klinika',
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
