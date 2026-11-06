import type { AdminCourse } from '@dah-pango/contracts';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatRange } from '@/lib/format';
import { apiGet } from '@/lib/session';
import { SlotsEditor } from './slots-editor';

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const course = await apiGet<AdminCourse>(`/admin/courses/${id}`);
  if (!course) notFound();

  return (
    <div className="space-y-6">
      <Link href="/app/configuracion/clases" className="link text-sm text-mute">
        ← Clases
      </Link>
      <div>
        <h2 className="font-display text-3xl uppercase">{course.title}</h2>
        <p className="text-sm text-mute">
          {course.program?.name ?? 'Clase general'}
          {course.modality === 'online' ? ' · En línea' : ''}
          {course.startsOn && course.endsOn ? ` · Solo ${formatRange(course.startsOn, course.endsOn)}` : ''}
        </p>
      </div>
      {course.kind === 'special' ? (
        <p className="text-mute">
          Las clases especiales no tienen horario semanal: sus sesiones van en fechas sueltas.
        </p>
      ) : (
        <SlotsEditor key={JSON.stringify(course.slots)} course={course} />
      )}
    </div>
  );
}
