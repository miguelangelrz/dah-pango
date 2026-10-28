'use client';

import { PASSWORD_MIN_LENGTH } from '@dah-pango/contracts';
import type { DocumentType } from '@dah-pango/domain';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DocumentTypeSelect, Field, FormError, SubmitButton } from '@/components/form';
import { postJson } from '@/lib/api';

export function SignupForm() {
  const router = useRouter();
  const [documentType, setDocumentType] = useState<DocumentType>('CC');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (form.get('password') !== form.get('passwordAgain')) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await postJson('/auth/signup', {
        fullName: form.get('fullName'),
        documentType,
        documentNumber: form.get('documentNumber'),
        phone: form.get('phone'),
        password: form.get('password'),
      });
      router.replace('/terminos');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field label="Nombre completo" name="fullName" autoComplete="name" required />
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
        hint="Con este número vas a ingresar."
        required
      />
      <Field label="Celular" name="phone" type="tel" inputMode="tel" autoComplete="tel" required />
      <Field
        label="Contraseña"
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        hint={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres.`}
        required
      />
      <Field
        label="Repite la contraseña"
        name="passwordAgain"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        required
      />
      {documentType === 'TI' && (
        <p className="text-sm text-mute">
          Como eres menor de edad, en el siguiente paso tu mamá, papá o acudiente debe aceptar los
          términos contigo.
        </p>
      )}
      <FormError message={error} />
      <SubmitButton busy={busy}>Crear cuenta</SubmitButton>
      <p className="text-center text-sm text-mute">
        ¿Ya tienes cuenta?{' '}
        <Link href="/ingresar" className="font-medium text-chalk underline underline-offset-4">
          Ingresa
        </Link>
      </p>
    </form>
  );
}
