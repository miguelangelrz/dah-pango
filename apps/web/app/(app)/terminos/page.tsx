import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/form';
import { getMe } from '@/lib/session';
import { ConsentForm } from './consent-form';

export const metadata = { title: 'Términos · Dah Pango' };

export default async function TermsPage() {
  const me = await getMe();
  if (!me) redirect('/ingresar');
  if (me.pendingLegalDocuments.length === 0) redirect('/app');
  return (
    <AuthShell title="Antes de empezar">
      <ConsentForm me={me} />
    </AuthShell>
  );
}
