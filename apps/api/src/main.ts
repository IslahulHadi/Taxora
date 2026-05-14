import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, VersioningType } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module.js';
import { ProblemFilter } from './common/problem.filter.js';

/**
 * API entrypoint.
 *
 * Decisions:
 *   - Fastify adapter: lower overhead than Express, native async/await, the
 *     same instance can be shared with @fastify/helmet for CSP/HSTS in one
 *     place.
 *   - URL versioning (`/v1/...`) so we never paint ourselves into a corner
 *     on breaking changes. `/health`, `/readyz`, `/auth/*` are intentionally
 *     unversioned.
 *   - Global ProblemFilter so every error response is RFC 7807-shaped.
 *   - CORS allow-listed via env. Default in dev: localhost:3000.
 */
async function bootstrap(): Promise<void> {
  const port = Number(process.env['PORT'] ?? 4000);
  const host = process.env['HOST'] ?? '0.0.0.0';

  const adapter = new FastifyAdapter({
    logger: process.env['NODE_ENV'] === 'production',
    genReqId: () => randomReqId(),
    trustProxy: true,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: undefined });
  app.enableCors({
    origin: parseAllowedOrigins(process.env['CORS_ALLOW_ORIGIN']),
    credentials: true,
  });
  app.useGlobalFilters(new ProblemFilter());

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [`'self'`],
        // Permissive for an API; the web app sets stricter CSP separately.
        scriptSrc: [`'self'`],
        styleSrc:  [`'self'`, `'unsafe-inline'`],
      },
    },
  });

  await app.listen(port, host);
  new Logger('bootstrap').log(`▶ Taxora API listening on http://${host}:${port}`);
}

function parseAllowedOrigins(env: string | undefined): string[] {
  if (!env) return ['http://localhost:3000'];
  return env.split(',').map((s) => s.trim()).filter(Boolean);
}

function randomReqId(): string {
  return randomUUID();
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal during API bootstrap:', err);
  process.exit(1);
});
