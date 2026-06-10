import type { Metadata } from 'next';

import { ReceptionHome } from './reception-home';

export const metadata: Metadata = {
  title: 'Kalendari · Klinika',
};

export default function ReceptionistHome() {
  return <ReceptionHome />;
}
