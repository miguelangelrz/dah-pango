'use client';

import type { AdminTerm, SessionSyncSummary } from '@dah-pango/contracts';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Field, FormError, SubmitButton } from '@/components/form';
import { postJson } from '@/lib/api';

export function NewTermForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-outline btn-block rounded-full">
        Nuevo semestre
      </button>
    );
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const { term } = await postJson<{ term: AdminTerm; sessions: SessionSyncSummary }>('/admin/terms', {
        name: form.get('name'),
        startsOn: form.get('startsOn'),
        endsOn: form.get('endsOn'),
      });
      router.push(`/app/configuracion/semestres/${term.id}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="fieldset space-y-4 rounded-box border border-base-300 p-4">
      <legend className="fieldset-legend text-base">Nuevo semestre</legend>
      <Field label="Nombre" name="name" placeholder="Primer semestre 2027" required />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Empieza" name="startsOn" type="date" required />
        <Field label="Termina" name="endsOn" type="date" required />
      </div>
      <FormError message={error} />
      <SubmitButton busy={busy}>Crear semestre</SubmitButton>
      <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost btn-block rounded-full">
        Cancelar
      </button>
    </form>
  );
}
