import { AdminShell } from '@/components/admin/admin-shell';
import { TenantDetailView } from './tenant-detail-view';

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminShell>
      <TenantDetailView id={id} />
    </AdminShell>
  );
}
