// Real-life roles (student, teacher, director) describe who someone is at the academy.
// `admin` is an app-only role with no place in classes: it can do everything a director
// can, for whoever runs the app (for example during development).
export const ROLES = ['student', 'teacher', 'director', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** Spanish labels shown in the app. */
export const ROLE_LABELS: Record<Role, string> = {
  student: 'Estudiante',
  teacher: 'Profe',
  director: 'Dirección',
  admin: 'Super admin',
};

/** What the app lets someone do, kept apart from who they are at the academy. */
export const PERMISSIONS = [
  'configure_academy', // semestres, bloques, horarios y duración de clases
  'review_requests', // aprobar o negar inscripciones, cambios y reposiciones
  'manage_sessions', // cancelar o reprogramar sesiones
  'take_attendance',
  'send_requests',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  director: PERMISSIONS, // directors are superadmins
  teacher: ['take_attendance'],
  student: ['send_requests'],
};

type RoleList = readonly (Role | { role: Role })[];

function roleNames(roles: RoleList): Role[] {
  return roles.map((r) => (typeof r === 'string' ? r : r.role));
}

export function permissionsOf(roles: RoleList): Permission[] {
  const granted = new Set(roleNames(roles).flatMap((r) => ROLE_PERMISSIONS[r] ?? []));
  return PERMISSIONS.filter((p) => granted.has(p));
}

export function can(roles: RoleList, permission: Permission): boolean {
  return roleNames(roles).some((r) => ROLE_PERMISSIONS[r]?.includes(permission));
}

/** Directors and the app's super admins may do everything. */
export function isSuperAdmin(roles: RoleList): boolean {
  return roleNames(roles).some((r) => r === 'director' || r === 'admin');
}
