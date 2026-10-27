# Dah Pango

App web para la asistencia de Dah Pango (En Rouge y At My House): quién está en qué clase, qué pasó en cada sesión, solicitudes de cambio y reposiciones. Incluye la landing pública.

Diseño completo (reglas, roles, esquema, despliegue): [documento de diseño](https://claude.ai/artifact/EFYbDVsgnwKkwXXUhp72pn).

## Estructura

```text
apps/
  web/         Next.js: landing pública (/) y app (/app)
  api/         API en Fastify
packages/
  db/          Esquema Drizzle, migraciones y datos del semestre 2026-2
  domain/      Reglas puras: bloques, bloqueo de 24 h, avisos, cruces de horario, saldo de reposiciones
  contracts/   Esquemas Zod compartidos entre web y API
  config/      tsconfig base
infra/         Docker Compose de desarrollo y producción, Caddy, backups
```

## Desarrollo

Requisitos: Node 22, pnpm 10 y Docker (o un Postgres 16 local).

```sh
pnpm install
cp .env.example .env
pnpm db:up        # Postgres en Docker
pnpm db:migrate
pnpm db:seed      # semestre 2026-2: 2 programas, 8 líneas, 15 clases y sus sesiones
pnpm dev          # web en :3000, API en :4000
```

Otras tareas: `pnpm typecheck`, `pnpm test`, `pnpm db:generate` (nueva migración después de cambiar `packages/db/src/schema.ts`).

## Producción

Un solo VPS pequeño con `infra/docker-compose.yml`: Postgres, API, web y Caddy (HTTPS automático). Copia `infra/.env.example` a `infra/.env`, apunta el dominio al servidor y ejecuta `docker compose -f infra/docker-compose.yml up -d --build`. Las copias de seguridad diarias van a R2 o B2 con `infra/backup.sh`.

## Convenciones

- La interfaz está en español; el código, en inglés (`course` = Clase, `track` = Línea, `session` = Sesión).
- Horas en America/Bogota (UTC−5, sin horario de verano). Las fechas se guardan como `date` y los instantes como `timestamptz`.
- Las reglas viven en `packages/domain` con pruebas; la API y los triggers de la base de datos las hacen cumplir.
