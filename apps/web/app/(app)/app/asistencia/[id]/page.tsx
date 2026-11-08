import type { AttendanceSessionDetail, TeacherOption } from '@dah-pango/contracts';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/session';
import { SessionAttendance } from './session-attendance';

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, teachers] = await Promise.all([
    apiGet<AttendanceSessionDetail>(`/attendance/sessions/${id}`),
    apiGet<TeacherOption[]>('/attendance/teachers'),
  ]);
  if (!session) notFound();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(session.startsAt));

  return (
    <>
      <header className="flex items-center justify-between">
        <Link href="/app" className="font-display text-2xl tracking-wide">
          DAH PANGO
        </Link>
        <Link href={`/app/asistencia?fecha=${date}`} className="btn btn-ghost btn-sm rounded-full">
          Volver
        </Link>
      </header>
      <SessionAttendance initial={session} teachers={teachers ?? []} />
    </>
  );
}
