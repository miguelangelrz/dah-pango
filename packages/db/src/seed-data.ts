// Second semester 2026, taken from the schedule posts.
// Times are Bogotá wall-clock. Wednesday At My House clases have no end time on the
// post, so they are one hour each until the academy confirms.

export interface SeedSlot {
  weekday: number; // 1 = Monday ... 7 = Sunday
  startsAt: string;
  endsAt: string;
}

export interface SeedCourse {
  slug: string;
  title: string;
  style: string;
  slots: SeedSlot[];
  tracks: string[]; // track slugs; one clase can sit in several líneas
  topic?: string;
}

export interface SeedProgram {
  slug: string;
  name: string;
  description: string;
  accentColor: string;
  tracks: { slug: string; name: string; level: string; focus?: string }[];
  courses: SeedCourse[];
}

export const TERM_2026_2 = {
  name: 'Segundo semestre 2026',
  // Set by hand: At My House posted the week of 6 July, En Rouge the week of 13 July.
  startsOn: '2026-07-06',
  endsOn: '2026-12-20',
};

export const PROGRAMS: SeedProgram[] = [
  {
    slug: 'en-rouge',
    name: 'En Rouge',
    description: 'Proceso formativo en dancehall y acrobacia.',
    accentColor: '#FF2A00',
    tracks: [
      { slug: 'baby-en-rouge', name: 'Baby En Rouge', level: 'Iniciación' },
      { slug: 'en-rouge-fam', name: 'En Rouge Fam', level: 'Intermedio / Avanzado' },
      { slug: 'skill-and-out', name: 'Skill and Out', level: 'Multinivel', focus: 'Acrobacia' },
    ],
    courses: [
      {
        slug: 'female-dancehall',
        title: 'Female Dancehall',
        style: 'Dancehall',
        slots: [{ weekday: 1, startsAt: '18:30', endsAt: '19:30' }],
        tracks: ['baby-en-rouge', 'en-rouge-fam'],
      },
      {
        slug: 'dancehall-mixto',
        title: 'Dancehall Mixto',
        style: 'Dancehall',
        slots: [{ weekday: 1, startsAt: '19:30', endsAt: '20:30' }],
        tracks: ['baby-en-rouge', 'en-rouge-fam'],
      },
      {
        slug: 'proceso-formativo-iniciacion',
        title: 'Proceso formativo Iniciación',
        style: 'Dancehall',
        slots: [{ weekday: 3, startsAt: '18:00', endsAt: '19:30' }],
        tracks: ['baby-en-rouge'],
      },
      {
        slug: 'proceso-formativo-avanzado',
        title: 'Proceso formativo Avanzado',
        style: 'Dancehall',
        slots: [{ weekday: 5, startsAt: '19:30', endsAt: '21:00' }],
        tracks: ['en-rouge-fam'],
      },
      {
        slug: 'skill-and-out-lunes',
        title: 'Skill and Out (lunes)',
        style: 'Acrobacia',
        slots: [{ weekday: 1, startsAt: '18:00', endsAt: '19:30' }],
        tracks: ['skill-and-out'],
      },
      {
        slug: 'skill-and-out-viernes',
        title: 'Skill and Out (viernes)',
        style: 'Acrobacia',
        slots: [{ weekday: 5, startsAt: '15:00', endsAt: '16:30' }],
        tracks: ['skill-and-out'],
      },
    ],
  },
  {
    slug: 'at-my-house',
    name: 'At My House',
    description: 'Proceso formativo en hip hop y house, con acondicionamiento.',
    accentColor: '#F7941D',
    tracks: [
      {
        slug: 'profesionalizacion',
        name: 'Profesionalización',
        level: 'Programa de 3 años',
        focus: 'Formadores de Hip Hop y House',
      },
      { slug: 'semilleros-avanzado', name: 'Semilleros Avanzado', level: 'Avanzado' },
      { slug: 'semilleros-inicial', name: 'Semilleros Inicial', level: 'Inicial' },
      {
        slug: 'coreografia-funcional',
        name: 'Coreografía + Funcional',
        level: 'Entrenamiento técnico',
      },
      { slug: 'all-styles', name: 'All Styles', level: 'Entrenamiento mensual' },
    ],
    courses: [
      {
        slug: 'profesionalizacion-house',
        title: 'Profesionalización: House Dance',
        style: 'House',
        slots: [{ weekday: 1, startsAt: '18:00', endsAt: '21:00' }],
        tracks: ['profesionalizacion'],
      },
      {
        slug: 'semilleros-avanzado-hip-hop',
        title: 'Semilleros Avanzado: Hip Hop',
        style: 'Hip Hop',
        slots: [{ weekday: 2, startsAt: '18:00', endsAt: '19:30' }],
        tracks: ['semilleros-avanzado'],
      },
      {
        slug: 'semilleros-avanzado-house',
        title: 'Semilleros Avanzado: House',
        style: 'House',
        slots: [{ weekday: 2, startsAt: '19:30', endsAt: '21:00' }],
        tracks: ['semilleros-avanzado'],
      },
      {
        slug: 'semilleros-inicial-hip-hop',
        title: 'Semilleros Inicial: Hip Hop',
        style: 'Hip Hop',
        slots: [{ weekday: 4, startsAt: '18:00', endsAt: '19:30' }],
        tracks: ['semilleros-inicial'],
      },
      {
        slug: 'semilleros-inicial-house',
        title: 'Semilleros Inicial: House',
        style: 'House',
        slots: [{ weekday: 4, startsAt: '19:30', endsAt: '21:00' }],
        tracks: ['semilleros-inicial'],
      },
      {
        slug: 'funcional',
        title: 'Funcional',
        style: 'Acondicionamiento',
        slots: [{ weekday: 3, startsAt: '18:00', endsAt: '19:00' }],
        tracks: ['coreografia-funcional'],
      },
      {
        slug: 'coreografia-hip-hop',
        title: 'Coreografía: Hip Hop',
        style: 'Hip Hop',
        slots: [{ weekday: 3, startsAt: '19:00', endsAt: '20:00' }],
        tracks: ['coreografia-funcional'],
      },
      {
        slug: 'coreografia-house',
        title: 'Coreografía: House',
        style: 'House',
        slots: [{ weekday: 3, startsAt: '20:00', endsAt: '21:00' }],
        tracks: ['coreografia-funcional'],
      },
      {
        slug: 'all-styles',
        title: 'All Styles',
        style: 'Street Dance',
        slots: [{ weekday: 6, startsAt: '14:00', endsAt: '15:30' }],
        tracks: ['all-styles'],
      },
    ],
  },
];
