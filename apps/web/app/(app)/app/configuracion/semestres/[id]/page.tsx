import type { AdminTerm } from '@dah-pango/contracts';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/session';
import { BlocksEditor } from './blocks-editor';
import { TermForm } from './term-form';

export default async function TermPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const term = await apiGet<AdminTerm>(`/admin/terms/${id}`);
  if (!term) notFound();

  return (
    <div className="space-y-8">
      <Link href="/app/configuracion/semestres" className="link text-sm text-mute">
        ← Semestres
      </Link>
      <section className="space-y-3">
        <h2 className="font-display text-3xl uppercase">{term.name}</h2>
        <p className="text-xs text-mute">
          {term.sessionCount} sesiones · {term.enrollmentCount} inscripciones
        </p>
        <TermForm key={`${term.startsOn}-${term.endsOn}-${term.name}`} term={term} />
      </section>
      <section className="space-y-3">
        <h2 className="font-display text-3xl uppercase">Bloques</h2>
        <BlocksEditor key={term.blocks.map((b) => b.startsOn + b.endsOn).join()} term={term} />
      </section>
    </div>
  );
}
