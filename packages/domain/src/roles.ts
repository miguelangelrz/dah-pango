export const ROLES = ['student', 'teacher', 'director'] as const;
export type Role = (typeof ROLES)[number];

/** Spanish labels shown in the app. */
export const ROLE_LABELS: Record<Role, string> = {
  student: 'Estudiante',
  teacher: 'Profe',
  director: 'Dirección',
};
