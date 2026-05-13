import { AdminShell } from '@/components/admin/admin-shell';
import { TenantsListView } from './tenants-list-view';

export default function AdminHomePage() {
  return (
    <AdminShell>
      <TenantsListView />
    </AdminShell>
  );
}
