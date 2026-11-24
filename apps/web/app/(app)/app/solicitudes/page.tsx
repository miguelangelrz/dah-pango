import type { StudentEnrollmentRequest } from '@dah-pango/contracts';
import { redirect } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { apiGet } from '@/lib/session';
import { RequestList } from './request-list';

export default async function MyRequestsPage() {
  const requests = await apiGet<StudentEnrollmentRequest[]>('/student/enrollment-requests');
  if (!requests) redirect('/app');

  return (
    <PageShell title="Mis solicitudes" intro="Lo que le pediste al director este semestre y lo que respondió.">
      <RequestList requests={requests} />
    </PageShell>
  );
}
