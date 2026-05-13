import { AdminShell } from '@/components/admin/admin-shell';
import { PlatformHealthView } from './platform-health-view';

export default function PlatformHealthPage() {
  return (
    <AdminShell>
      <PlatformHealthView />
    </AdminShell>
  );
}
