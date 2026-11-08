import type { RequestOptions, RequestView } from '@dah-pango/contracts';
import { redirect } from 'next/navigation';
import { PageShell } from '@/components/page-shell';
import { apiGet } from '@/lib/session';
import { RequestsScreen, type RequestKind } from './requests-screen';

const KINDS: Record<string, RequestKind> = {
  inscripcion: 'join',
  cambio: 'swap',
  salida: 'leave',
  reposicion: 'makeup',
};

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ tipo?: string }> }) {
  const { tipo } = await searchParams;
  const [requests, options] = await Promise.all([
    apiGet<RequestView[]>('/student/requests'),
    apiGet<RequestOptions>('/student/options'),
  ]);
  if (!requests || !options) redirect('/app');

  return (
    <PageShell
      title="Solicitudes"
      back="/app/clases"
      intro="Pide entrar a una línea o clase, cambiarte, salir o tomar una reposición. Dirección revisa y te responde aquí."
    >
      <RequestsScreen initialRequests={requests} options={options} initialKind={tipo ? KINDS[tipo] : undefined} />
    </PageShell>
  );
}
