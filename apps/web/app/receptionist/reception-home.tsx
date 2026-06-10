'use client';

import { useBreakpoint } from '@/lib/hooks/use-breakpoint';
import { CalendarView } from './calendar-view';
import { MobileReceptionHome } from './mobile-reception-home';

/**
 * Receptionist home dispatcher (mobile handoff §5). At ≥1280px the
 * untouched desktop calendar renders; below that, the mobile/tablet
 * day-list + week-grid view. `useBreakpoint` defaults to `desktop`
 * pre-mount, so desktop renders with no flash and the desktop calendar
 * is never mounted on a real phone past the first paint.
 */
export function ReceptionHome() {
  const { isDesktop } = useBreakpoint();
  return isDesktop ? <CalendarView /> : <MobileReceptionHome />;
}
