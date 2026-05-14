import type { Metadata } from 'next';

import { CalendarView } from './calendar-view';

export const metadata: Metadata = {
  title: 'Kalendari · Klinika',
};

export default function ReceptionistHome() {
  return <CalendarView />;
}
