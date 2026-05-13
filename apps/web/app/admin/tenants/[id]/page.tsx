import { AdminShell } from '@/components/admin/admin-shell';
import { TenantDetailView } from './tenant-detail-view';

export default function TenantDetailPage({ params }: { params: { id: string } }) {
  return (
    <AdminShell>
      <TenantDetailView id={params.id} />
    </AdminShell>
  );
}
