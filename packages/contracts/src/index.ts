import { ATTENDANCE_STATES, DOCUMENT_TYPES, type LegalDocumentKind } from '@dah-pango/domain';
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
  roles: { role: 'student' | 'teacher' | 'director'; programId: string | null }[];
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
