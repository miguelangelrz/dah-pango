'use client';

import type { DocumentType } from '@dah-pango/domain';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DocumentTypeSelect, Field, FormError, SubmitButton } from '@/components/form';
import { postJson } from '@/lib/api';

export function LoginForm() {
  const router = useRouter();
  const [documentType, setDocumentType] = useState<DocumentType>('CC');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await postJson('/auth/login', {
        documentType,
        documentNumber: form.get('documentNumber'),
        password: form.get('password'),
      });
      router.replace('/app');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <DocumentTypeSelect
        name="documentType"
        value={documentType}
        onChange={(e) => setDocumentType(e.target.value as DocumentType)}
      />
      <Field
        label="Número de documento"
        name="documentNumber"
        inputMode={documentType === 'CC' || documentType === 'TI' ? 'numeric' : 'text'}
        autoComplete="username"
        required
      />
      <Field label="Contraseña" name="password" type="password" autoComplete="current-password" required />
      <FormError message={error} />
      <SubmitButton busy={busy}>Entrar</SubmitButton>
      <p className="text-center text-sm text-mute">
        ¿Primera vez?{' '}
        <Link href="/registro" className="font-medium text-chalk underline underline-offset-4">
          Crea tu cuenta
        </Link>
      </p>
      <p className="text-center text-xs text-mute">
        ¿Olvidaste tu contraseña? Escríbele a la dirección de tu programa.
      </p>
    </form>
  );
}
