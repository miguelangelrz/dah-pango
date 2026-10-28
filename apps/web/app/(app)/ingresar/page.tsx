import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/form';
import { getMe } from '@/lib/session';
import { LoginForm } from './login-form';

export const metadata = { title: 'Ingresar · Dah Pango' };

export default async function LoginPage() {
  if (await getMe()) redirect('/app');
  return (
    <AuthShell title="Ingresar">
      <LoginForm />
    </AuthShell>
  );
}
