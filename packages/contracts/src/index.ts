import { ATTENDANCE_STATES } from '@dah-pango/domain';
import { z } from 'zod';

// Shared request and response shapes for the API and the web app.

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida');

export const documentType = z.enum(['CC', 'TI', 'CE', 'PA']);

export const login = z.object({
  documentType,
  documentNumber: z.string().trim().min(3).max(20),
  password: z.string().min(8),
});
export type Login = z.infer<typeof login>;

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
