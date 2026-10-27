# Dah Pango

- Design doc with the agreed rules: https://claude.ai/artifact/EFYbDVsgnwKkwXXUhp72pn
- UI text is Spanish only; code, comments and commits are English.
- Vocabulary: Programa = program, Línea = track, Clase = course, Sesión = session, Inscripción = enrollment, Reposición = makeup.
- Business rules belong in `packages/domain` (pure functions with Vitest tests); the API calls them and DB triggers back them up.
- History is never overwritten: close and reopen enrollments, log attendance in `attendance_event`, keep the makeup balance as a ledger, keep consents append-only.
- After editing `packages/db/src/schema.ts`, run `pnpm db:generate`; hand-written SQL goes in a `--custom` migration.
- Check with `pnpm typecheck && pnpm test` before pushing.
