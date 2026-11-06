'use client';

import type { AdminTerm, SessionSyncSummary } from '@dah-pango/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Field, FormError, SubmitButton } from '@/components/form';
import { putJson } from '@/lib/api';
import { describeSync } from '@/lib/format';

export function TermForm({ term }: { term: AdminTerm }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = term.enrollmentCount > 0;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const startsOn = String(form.get('startsOn') ?? term.startsOn);
    const endsOn = String(form.get('endsOn') ?? term.endsOn);
    const moved = startsOn !== term.startsOn || endsOn !== term.endsOn;
    if (moved && !confirm('Los bloques se van a recalcular desde el inicio y las sesiones que vienen se van a ajustar. ¿Seguimos?')) {
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const { sessions } = await putJson<{ sessions: SessionSyncSummary }>(`/admin/terms/${term.id}`, {
        name: form.get('name'),
        startsOn,
        endsOn,
      });
      setDone(moved ? `Guardado. ${describeSync(sessions)}` : 'Guardado.');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Nombre" name="name" defaultValue={term.name} required />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Empieza" name="startsOn" type="date" defaultValue={term.startsOn} disabled={locked} required />
        <Field label="Termina" name="endsOn" type="date" defaultValue={term.endsOn} disabled={locked} required />
      </div>
      {locked && (
        <p className="text-xs text-mute">
          Este semestre ya tiene inscripciones, así que sus fechas quedan fijas.
        </p>
      )}
      <FormError message={error} />
      {done && (
        <p role="status" className="alert alert-success alert-soft text-sm">
          {done}
        </p>
      )}
      <SubmitButton busy={busy}>Guardar semestre</SubmitButton>
    </form>
  );
}
