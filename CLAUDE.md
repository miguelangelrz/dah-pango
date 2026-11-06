# Dah Pango

Web app for Dah Pango, a hip hop, house and dancehall academy in Bogotá: who is in which class, what happened in each session, change requests and makeups, plus the public landing page. Phones and tablets first, browser only (no installable app).

The design doc holds the full agreed rules: https://claude.ai/artifact/EFYbDVsgnwKkwXXUhp72pn. When a rule here and the code disagree, ask before changing either.

## Vocabulary

UI text is Spanish only; code, comments and commits are English.

| UI (es) | Code (en) | Notes |
| --- | --- | --- |
| Programa | `program` | En Rouge (dancehall + acrobatics), At My House (hip hop, house, conditioning). One director each. |
| Línea | `track` | A group of clases inside a programa. One clase can sit in several líneas. |
| Clase | `course` | `kind`: `weekly` (with `course_slot` rows) or `special` (one-off dates). `modality`: `on_site` (default) or `online`. A clase with no programa is a general (academy-wide) clase led by a director. |
| Sesión | `session` | One dated occurrence of a clase. `status`: `scheduled`, `cancelled`, `rescheduled`. |
| Semestre | `term` | Start and end set by hand. 2026-2 seed: 2026-07-06 to 2026-12-20. |
| Bloque | `block` | 4 weeks from the term start, same dates academy-wide. Payment is due before the 10th of each month. |
| Inscripción | `enrollment` | In a línea or a single clase. Starts any day, always ends with the term. |
| Reposición | `makeup` | Balance kept in `makeup_ledger`. |

## Business rules

- Roles (`role_grant`): `student`, `teacher`, `director`, plus the app-only `admin` (super admin: every director permission, no clases). Directors are superadmins and are also teachers. Check what someone may do with `can(roles, permission)` from `packages/domain/src/roles.ts`, not by role names. One person can be student and teacher. Guest teachers may exist with only a name; a director then takes their attendance.
- Login is document number (`CC`, `TI`, `CE`, `PA`) + password, no verification yet. Phone is required for everyone, walk-ins included.
- On first login everyone accepts the Términos y condiciones and the data policy (Ley 1581 de 2012), versioned in `legal_document`; acceptance goes in `consent` with date and device, and a new version asks again. Minors (`TI`) need a guardian to accept, saving the guardian's name, document and phone.
- Students request enrollments, changes and makeups; a director can edit (e.g. the start date), then approves or denies. No class size limits. A student's clases must not overlap in time (`findOverlaps`).
- Attendance states: `present` (Asistió), `absent` (Falta), `excused` (Falta con aviso, earns a makeup credit), `makeup` (Reposición, uses one). Origins: `enrolled`, `makeup`, `walk_in`.
- Students can send an absence notice until 24 h before the session; a teacher can mark `excused` any time before the lock.
- Lock: 24 h after the session ends. Unmarked rows become `absent`, and nobody can edit after it, directors included.
- Teachers take attendance, can hand a session to a substitute, add a student as a makeup, and add walk-ins (marked present; their history joins their account later by document number).
- Only directors cancel a session (everyone on the list gets a credit) or reschedule it (students send notice if it clashes).
- Makeups stay in the same programa or a general clase, never expire, and the balance can go negative. A makeup in a general clase settles the most recent `excused` credit and counts against that programa (`programForGeneralMakeup`).
- Special clases have their own attendance, may or may not belong to a programa, and welcome outside people who sign up ahead or are added at the door.

## Repo layout

```text
apps/web          Next.js: landing at (landing)/, app under (app)/app
apps/api          Fastify API
packages/domain   Pure business rules with Vitest tests (attendance, blocks, makeups, schedule, dates)
packages/db       Drizzle schema, migrations, 2026-2 seed
packages/contracts Zod schemas shared by web and API
packages/config   Base tsconfig
infra             Docker Compose (dev and prod), Caddy, backups
```

Built: document + password login, sign-up, first-login consent (`apps/api/src/auth`, web `/ingresar`, `/registro`, `/terminos`). Director accounts and password resets: `pnpm account --document CC:123 --name ... --phone ... --password ... [--director <program-slug>] [--admin]`.

Built: academy configuration for directors and super admins (`apps/api/src/admin`, web `/app/configuracion`): semestres, bloques, weekly slots and durations. Changes re-sync only sesiones that haven't started (`syncSessions` in `packages/domain/src/calendar.ts`); sesiones with records are kept.

Built: attendance for teachers, directors and super admins (`apps/api/src/attendance`, web `/app/asistencia`): the day's sesiones and open ones still to mark, marking, makeups (debit the clase's programa, or `ledgerProgram` for general clases), walk-ins (matched by document), handing a sesión to another teacher or a guest (logged in `session_handoff`). The lock job (`lockDueSessions`) runs every 10 minutes and before attendance is shown; it stamps `session.locked_at`.

Not built yet: student screens (absence notices, requests), request review, cancel/reschedule screens, creating or editing clases themselves (title, teacher, líneas).

## Commands

Node 22, pnpm 10, Docker (or a local Postgres 16). Copy `.env.example` to `.env` at the root.

```sh
pnpm install
pnpm db:up          # Postgres in Docker
pnpm db:migrate
pnpm db:seed        # 2026-2: 2 programas, 8 líneas, 15 clases and their sesiones, plus demo people (--no-demo to skip; never in production)
pnpm dev            # web :3000, API :4000
pnpm typecheck && pnpm test   # run before pushing; CI also builds web
```

## Conventions

- Business rules belong in `packages/domain` as pure functions with tests; the API calls them and DB triggers back them up (`0001_rules_triggers.sql`).
- History is never overwritten: close and reopen enrollments, log every attendance write in `attendance_event`, keep makeups as a ledger, keep consents append-only. Every enrollment change is recorded in `enrollment_change`.
- Times are America/Bogota (UTC−5, no DST). Store calendar days as `date` and instants as `timestamptz`; use the helpers in `packages/domain/src/dates.ts`.
- After editing `packages/db/src/schema.ts`, run `pnpm db:generate`; hand-written SQL goes in a `--custom` migration.
- Web UI uses daisyUI 5 classes (`btn`, `input`, `select`, `card`...) with the `dahpango` theme defined in `apps/web/app/globals.css`; shared form pieces live in `apps/web/components/form.tsx`.
- Deployment target is one small VPS with `infra/docker-compose.yml` and Caddy. No AWS.
