import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/form';
import { getMe } from '@/lib/session';
import { SignupForm } from './signup-form';

export const metadata = { title: 'Crear cuenta · Dah Pango' };

export default async function SignupPage() {
  if (await getMe()) redirect('/app');
  return (
    <AuthShell title="Crea tu cuenta">
      <SignupForm />
    </AuthShell>
  );
}
