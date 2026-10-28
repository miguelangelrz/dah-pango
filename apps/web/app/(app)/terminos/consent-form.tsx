'use client';

import type { Me } from '@dah-pango/contracts';
import { LEGAL_DOCUMENT_LABELS } from '@dah-pango/domain';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DocumentTypeSelect, Field, FormError, SubmitButton } from '@/components/form';
import { postJson } from '@/lib/api';

export function ConsentForm({ me }: { me: Me }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const docs = me.pendingLegalDocuments;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await postJson('/auth/consents', {
        legalDocumentIds: docs.map((d) => d.id),
        guardian: me.needsGuardian
          ? {
              fullName: form.get('guardianName'),
              documentType: form.get('guardianDocumentType'),
              documentNumber: form.get('guardianDocumentNumber'),
              phone: form.get('guardianPhone'),
            }
          : undefined,
      });
      router.replace('/app');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <p className="text-mute">
        {me.needsGuardian
          ? 'Para usar la app, tu mamá, papá o acudiente debe leer y aceptar estos documentos.'
          : 'Para usar la app, lee y acepta estos documentos.'}
      </p>

      {docs.map((doc) => (
        <section key={doc.id} className="rounded-2xl border border-line bg-concrete">
          <h2 className="border-b border-line px-4 py-3 font-semibold">
            {LEGAL_DOCUMENT_LABELS[doc.kind]}{' '}
            <span className="text-sm font-normal text-mute">versión {doc.version}</span>
          </h2>
          <div className="max-h-60 overflow-y-auto px-4 py-3 text-sm whitespace-pre-line text-mute">
            {doc.body}
          </div>
          <label className="flex items-start gap-3 border-t border-line px-4 py-3">
            <input type="checkbox" required className="mt-1 size-5 accent-house" />
            <span className="text-sm">
              He leído y acepto {doc.kind === 'terms' ? 'los' : 'la'}{' '}
              {LEGAL_DOCUMENT_LABELS[doc.kind]}.
            </span>
          </label>
        </section>
      ))}

      {me.needsGuardian && (
        <fieldset className="space-y-5 rounded-2xl border border-line p-4">
          <legend className="px-2 font-semibold">Datos del acudiente</legend>
          <Field label="Nombre completo" name="guardianName" autoComplete="off" required />
          <DocumentTypeSelect
            label="Tipo de documento"
            name="guardianDocumentType"
            types={['CC', 'CE', 'PA']}
          />
          <Field label="Número de documento" name="guardianDocumentNumber" required />
          <Field label="Celular" name="guardianPhone" type="tel" inputMode="tel" required />
          <label className="flex items-start gap-3">
            <input type="checkbox" required className="mt-1 size-5 accent-house" />
            <span className="text-sm">
              Soy la mamá, el papá o el acudiente de {me.fullName} y acepto en su nombre.
            </span>
          </label>
        </fieldset>
      )}

      <FormError message={error} />
      <SubmitButton busy={busy}>Aceptar y continuar</SubmitButton>
    </form>
  );
}
