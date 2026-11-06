import {
  ATTENDANCE_STATES,
  DOCUMENT_TYPES,
  type LegalDocumentKind,
  type Permission,
  type Role,
} from '@dah-pango/domain';
import { z } from 'zod';

// Shared request and response shapes for the API and the web app.

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');

export const documentType = z.enum(DOCUMENT_TYPES, 'Elige el tipo de documento');

const documentNumber = z
  .string()
  .trim()
  .min(3, 'Escribe el número de documento')
  .max(20, 'El número de documento es muy largo');

const phone = z
  .string()
  .trim()
  .regex(/^\+?[\d\s-]{7,20}$/, 'Escribe un número de celular válido');

const fullName = z.string().trim().min(3, 'Escribe tu nombre completo').max(120);

export const PASSWORD_MIN_LENGTH = 8;

export const login = z.object({
  documentType,
  documentNumber,
  password: z.string().min(1, 'Escribe tu contraseña').max(128),
});
export type Login = z.infer<typeof login>;

export const signup = z.object({
  fullName,
  documentType,
  documentNumber,
  phone,
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`)
    .max(128, 'La contraseña es muy larga'),
});
export type Signup = z.infer<typeof signup>;

/** Minors (TI) need a guardian, who must be an adult. */
export const guardian = z.object({
  fullName,
  documentType: z.enum(['CC', 'CE', 'PA'], 'Elige el documento del acudiente'),
  documentNumber,
  phone,
});
export type Guardian = z.infer<typeof guardian>;

export const acceptLegalDocuments = z.object({
  legalDocumentIds: z.array(z.uuid()).min(1),
  guardian: guardian.optional(),
});
export type AcceptLegalDocuments = z.infer<typeof acceptLegalDocuments>;

export interface PendingLegalDocument {
  id: string;
  kind: LegalDocumentKind;
  version: string;
  body: string;
}

/** The logged-in person, as GET /auth/me returns it. */
export interface Me {
  id: string;
  fullName: string;
  documentType: z.infer<typeof documentType>;
  documentNumber: string;
  roles: { role: Role; programId: string | null }[];
  /** What the app lets them do, from their roles (directors and super admins: everything). */
  permissions: Permission[];
  needsGuardian: boolean;
  pendingLegalDocuments: PendingLegalDocument[];
}

export const markAttendance = z.object({
  sessionId: z.uuid(),
  personId: z.uuid(),
  state: z.enum(ATTENDANCE_STATES),
});
export type MarkAttendance = z.infer<typeof markAttendance>;

export const addWalkIn = z.object({
  sessionId: z.uuid(),
  fullName: z.string().trim().min(2),
  phone: z.string().trim().min(7),
  documentType: documentType.optional(),
  documentNumber: z.string().trim().optional(),
});
export type AddWalkIn = z.infer<typeof addWalkIn>;

export const enrollmentRequest = z
  .object({
    action: z.enum(['join', 'leave', 'swap']),
    trackId: z.uuid().optional(),
    courseId: z.uuid().optional(),
    replacesEnrollmentId: z.uuid().optional(),
    wantedStart: isoDate.optional(),
    note: z.string().max(500).optional(),
  })
  .refine((r) => r.action === 'leave' || Boolean(r.trackId) !== Boolean(r.courseId), {
    message: 'Elige una línea o una clase',
  });
export type EnrollmentRequest = z.infer<typeof enrollmentRequest>;

export const makeupRequest = z.object({
  sessionId: z.uuid(),
  note: z.string().max(500).optional(),
});
export type MakeupRequest = z.infer<typeof makeupRequest>;

// Academy configuration (directors and super admins)

const termName = z.string().trim().min(3, 'Escribe el nombre del semestre').max(80, 'El nombre es muy largo');

export const termInput = z.object({ name: termName, startsOn: isoDate, endsOn: isoDate });
export type TermInput = z.infer<typeof termInput>;

export const blocksInput = z.object({
  blocks: z.array(z.object({ startsOn: isoDate, endsOn: isoDate })).min(1, 'Agrega al menos un bloque').max(12),
});
export type BlocksInput = z.infer<typeof blocksInput>;

export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida');

export const slotInput = z.object({
  weekday: z.int().min(1).max(7),
  startsAt: time,
  durationMinutes: z
    .int('La duración va en minutos')
    .min(15, 'La clase dura al menos 15 minutos')
    .max(360, 'La clase dura máximo 6 horas'),
});
export type SlotInput = z.infer<typeof slotInput>;

export const courseSlotsInput = z.object({ slots: z.array(slotInput).max(14) });
export type CourseSlotsInput = z.infer<typeof courseSlotsInput>;

export interface AdminBlock {
  id: string;
  number: number;
  startsOn: string;
  endsOn: string;
}

export interface AdminTerm {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  blocks: AdminBlock[];
  sessionCount: number;
  enrollmentCount: number;
}

export interface AdminSlot {
  weekday: number;
  startsAt: string; // 'HH:MM'
  endsAt: string;
  durationMinutes: number;
}

export interface AdminCourse {
  id: string;
  title: string;
  kind: 'weekly' | 'special';
  modality: 'on_site' | 'online';
  program: { id: string; name: string; accentColor: string | null } | null;
  startsOn: string | null;
  endsOn: string | null;
  slots: AdminSlot[];
}

/** What happened to the sesiones after a schedule or calendar change. */
export interface SessionSyncSummary {
  created: number;
  updated: number;
  removed: number;
  /** Dropped by the new schedule but already with records: a director cancels them by hand. */
  kept: number;
}
