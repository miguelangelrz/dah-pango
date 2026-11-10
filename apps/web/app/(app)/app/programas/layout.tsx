import { redirect } from 'next/navigation';
import { getMe } from '@/lib/session';

// A student's clases per programa, and their requests to change them.
export default async function StudentProgramsLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  if (!me) redirect('/ingresar');
  if (!me.permissions.includes('send_requests')) redirect('/app');
  return children;
}
