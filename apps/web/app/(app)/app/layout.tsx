import { redirect } from 'next/navigation';
import { getMe } from '@/lib/session';

// Everything under /app needs a session and the current terms accepted.
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/ingresar');
  if (me.pendingLegalDocuments.length > 0) redirect('/terminos');
  return children;
}
