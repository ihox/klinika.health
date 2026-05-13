import { AdminShell } from '@/components/admin/admin-shell';
import { CreateTenantView } from './create-tenant-view';

export default function CreateTenantPage() {
  return (
    <AdminShell>
      <CreateTenantView />
    </AdminShell>
  );
}
