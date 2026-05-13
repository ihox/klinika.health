import { AdminShell } from '@/components/admin/admin-shell';
import { PlatformAdminsView } from './platform-admins-view';

export default function PlatformAdminsPage() {
  return (
    <AdminShell>
      <PlatformAdminsView />
    </AdminShell>
  );
}
