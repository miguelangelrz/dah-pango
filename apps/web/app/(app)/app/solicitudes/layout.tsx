import { redirect } from 'next/navigation';
import { getMe } from '@/lib/session';

// Students ask for inscripciones, cambios, salidas and reposiciones here.
export default async function RequestsLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/ingresar');
  if (!me.permissions.includes('send_requests')) redirect('/app');
  return children;
}
