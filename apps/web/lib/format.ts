import type { SessionSyncSummary } from '@dah-pango/contracts';

const dateFormat = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** '2026-07-06' as '6 jul 2026'. Calendar days are kept as UTC midnight so they never shift. */
export function formatDate(date: string): string {
  return dateFormat.format(new Date(`${date}T00:00:00Z`)).replace('.', '');
}

export function formatRange(startsOn: string, endsOn: string): string {
  return `${formatDate(startsOn)} – ${formatDate(endsOn)}`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** One sentence on how the sesiones changed, for the message after saving. */
export function describeSync(s: SessionSyncSummary): string {
  const parts: string[] = [];
  if (s.created) parts.push(`${s.created} ${s.created === 1 ? 'sesión nueva' : 'sesiones nuevas'}`);
  if (s.updated) parts.push(`${s.updated} con nueva duración`);
  if (s.removed) parts.push(`${s.removed} ${s.removed === 1 ? 'quitada' : 'quitadas'}`);
  let text = parts.length ? `Sesiones: ${parts.join(', ')}.` : 'Las sesiones ya estaban al día.';
  if (s.kept) {
    text += ` ${s.kept} ${s.kept === 1 ? 'sesión quedó' : 'sesiones quedaron'} igual porque ya tienen avisos o asistencia; Si ya no van, hay que cancelarlas.`;
  }
  return text;
}
