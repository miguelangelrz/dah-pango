import { createDb } from '@dah-pango/db';
import { buildApp } from './app';

const { db } = createDb();
const app = buildApp({ db, webOrigin: process.env.WEB_ORIGIN });

const port = Number(process.env.API_PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
