import type { RequestView } from '@dah-pango/contracts';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { apiGet } from '@/lib/session';
import { ReviewList } from './review-list';

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const { estado } = await searchParams;
  const all = estado === 'todas';
  const requests = await apiGet<RequestView[]>(`/requests${all ? '?estado=todas' : ''}`);
  if (!requests) redirect('/app');

  return (
    <PageShell
      title="Solicitudes"
      intro="Inscripciones, cambios, salidas y reposiciones que piden los estudiantes. Puedes ajustar la fecha antes de aprobar; cada cambio queda registrado."
    >
      <nav role="tablist" className="tabs tabs-box bg-base-200">
        <Link href="/app/revision" role="tab" className={`tab flex-1 ${all ? '' : 'tab-active'}`}>
          Pendientes
        </Link>
        <Link href="/app/revision?estado=todas" role="tab" className={`tab flex-1 ${all ? 'tab-active' : ''}`}>
          Todas
        </Link>
      </nav>
      <ReviewList key={all ? 'all' : 'pending'} initial={requests} all={all} />
    </PageShell>
  );
}
