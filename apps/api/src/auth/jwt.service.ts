import { Injectable, Logger } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';

/**
 * JWT issuance + verification using `jose` (no Node-specific crypto deps).
 *
 * Claims we set:
 *   sub  — user id
 *   tnt  — tenant id (uuid). The TenantGuard rejects requests missing this.
 *   roles — string[] (RBAC)
 *   exp/iat — standard
 *
 * For PR #4 we issue dev JWTs from a hardcoded HS256 secret. PR #6 adds:
 *   - asymmetric RS256 keys
 *   - real auth providers (email magic link, Google OIDC)
 *   - refresh token rotation
 */
export interface AppJwtClaims {
  sub: string;
  tnt: string;
  roles?: string[] | undefined;
  email?: string | undefined;
}

@Injectable()
export class JwtService {
  private readonly logger = new Logger('JwtService');
  private readonly secret: Uint8Array;
  private readonly expiresInSec: number;

  constructor() {
    const secret = process.env['JWT_SECRET'];
    if (!secret || secret.length < 16) {
      // We refuse weak secrets even in dev — easier to catch missing env.
      throw new Error(
        'JWT_SECRET environment variable must be set (>=16 chars). ' +
        'Set it in apps/api/.env for development.',
      );
    }
    this.secret = new TextEncoder().encode(secret);
    this.expiresInSec = parseDuration(process.env['JWT_EXPIRES_IN'] ?? '15m');
  }

  async sign(claims: AppJwtClaims): Promise<string> {
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${this.expiresInSec}s`)
      .sign(this.secret);
  }

  async verify(token: string): Promise<AppJwtClaims> {
    const { payload } = await jwtVerify(token, this.secret);
    if (typeof payload['sub'] !== 'string' || typeof payload['tnt'] !== 'string') {
      throw new Error('JWT missing required claims (sub, tnt)');
    }
    return {
      sub: payload['sub'],
      tnt: payload['tnt'],
      roles: Array.isArray(payload['roles']) ? (payload['roles'] as string[]) : undefined,
      email: typeof payload['email'] === 'string' ? payload['email'] : undefined,
    };
  }
}

/**
 * Parses durations like '15m', '24h', '7d', '30s' or a raw seconds number.
 * Used to translate JWT_EXPIRES_IN env to seconds.
 */
function parseDuration(input: string): number {
  const m = /^(\d+)\s*([smhd])?$/.exec(input.trim());
  if (!m) throw new Error(`invalid duration '${input}'`);
  const n = Number(m[1]);
  switch (m[2]) {
    case 's': case undefined: return n;
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    default:  throw new Error(`invalid duration unit in '${input}'`);
  }
}
