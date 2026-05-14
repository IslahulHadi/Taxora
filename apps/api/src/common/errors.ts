import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Base class for domain exceptions. Mapped to RFC 7807 by ProblemFilter.
 *
 * Always include a stable `code` (UPPER_SNAKE_CASE) so clients can branch
 * on it without parsing the human message.
 */
export class DomainException extends HttpException {
  constructor(
    public readonly code: string,
    public readonly title: string,
    status: HttpStatus,
    public readonly detail?: string,
    public readonly fields?: Array<{ path: string; message: string }>,
  ) {
    super({ code, title, detail, fields }, status);
  }
}

export class UnauthenticatedException extends DomainException {
  constructor(detail?: string) {
    super('UNAUTHENTICATED', 'Authentication required', HttpStatus.UNAUTHORIZED, detail);
  }
}

export class ForbiddenException extends DomainException {
  constructor(detail?: string) {
    super('FORBIDDEN', 'Forbidden', HttpStatus.FORBIDDEN, detail);
  }
}

export class TenantContextMissingException extends DomainException {
  constructor() {
    super(
      'TENANT_CONTEXT_MISSING',
      'Tenant context could not be resolved from the JWT',
      HttpStatus.UNAUTHORIZED,
      'The endpoint requires a tenant-scoped JWT (claim `tnt`).',
    );
  }
}
