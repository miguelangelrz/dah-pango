import { redirect } from 'next/navigation';
import { getMe } from '@/lib/session';

// A student's own clases, sesiones, absence notices and reposiciones.
export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/ingresar');
  if (!me.permissions.includes('send_requests')) redirect('/app');
  return children;
}
