'use client';

import type { Me } from '@dah-pango/contracts';
import { LEGAL_DOCUMENT_LABELS } from '@dah-pango/domain';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Checkbox, DocumentTypeSelect, Field, FormError, SubmitButton } from '@/components/form';
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
        <section key={doc.id} className="card card-border border-base-300 bg-base-200">
          <div className="card-body gap-3 p-4">
            <h2 className="card-title text-base">
              {LEGAL_DOCUMENT_LABELS[doc.kind]}
              <span className="badge badge-ghost badge-sm font-normal">versión {doc.version}</span>
            </h2>
            <div className="max-h-60 overflow-y-auto text-sm whitespace-pre-line text-mute">
              {doc.body}
            </div>
            <Checkbox required>
              He leído y acepto {doc.kind === 'terms' ? 'los' : 'la'}{' '}
              {LEGAL_DOCUMENT_LABELS[doc.kind]}.
            </Checkbox>
          </div>
        </section>
      ))}

      {me.needsGuardian && (
        <fieldset className="fieldset space-y-4 rounded-box border border-base-300 p-4">
          <legend className="fieldset-legend text-base">Datos del acudiente</legend>
          <Field label="Nombre completo" name="guardianName" autoComplete="off" required />
          <DocumentTypeSelect
            label="Tipo de documento"
            name="guardianDocumentType"
            types={['CC', 'CE', 'PA']}
          />
          <Field label="Número de documento" name="guardianDocumentNumber" required />
          <Field label="Celular" name="guardianPhone" type="tel" inputMode="tel" required />
          <Checkbox required>
            Soy la mamá, el papá o el acudiente de {me.fullName} y acepto en su nombre.
          </Checkbox>
        </fieldset>
      )}

      <FormError message={error} />
      <SubmitButton busy={busy}>Aceptar y continuar</SubmitButton>
    </form>
  );
}
