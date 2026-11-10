import type { StudentEnrollmentRequest, StudentProgram } from '@dah-pango/contracts';
import { redirect } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { apiGet } from '@/lib/session';
import { ProgramList } from './program-list';

export default async function MyProgramsPage() {
  const [programs, requests] = await Promise.all([
    apiGet<StudentProgram[]>('/student/programs'),
    apiGet<StudentEnrollmentRequest[]>('/student/enrollment-requests'),
  ]);
  if (!programs || !requests) redirect('/app');

  return (
    <PageShell title="Mis programas" intro="Tus clases de este semestre, por programa. Toca una clase para cambiarla o cancelarla.">
      <ProgramList programs={programs} pending={requests.filter((r) => r.status === 'pending')} />
    </PageShell>
  );
}
