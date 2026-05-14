import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainException } from './errors.js';

/**
 * Translates every thrown exception into an RFC 7807-style JSON document.
 *
 * Shape:
 *   {
 *     type:   "https://taxora.id/errors/<code>",
 *     title:  string,
 *     status: number,
 *     code:   string,         // stable, machine-actionable
 *     detail?: string,         // human-friendly
 *     fields?: [{ path, message }],
 *     traceId: string,         // ties to logs
 *     tenantId?: string
 *   }
 *
 * NEVER leak stack traces in production responses; we only log them.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();

    const traceId = (req.id as string | undefined) ?? cryptoRandomId();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let title = 'Internal server error';
    let detail: string | undefined;
    let fields: Array<{ path: string; message: string }> | undefined;

    if (exception instanceof DomainException) {
      status = exception.getStatus();
      code = exception.code;
      title = exception.title;
      detail = exception.detail;
      fields = exception.fields;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'object' && resp !== null) {
        const r = resp as Record<string, unknown>;
        code = (r['code'] as string) ?? mapStatusToCode(status);
        title = (r['title'] as string) ?? exception.message;
        detail = r['detail'] as string | undefined;
        fields = r['fields'] as typeof fields | undefined;
      } else {
        code = mapStatusToCode(status);
        title = String(resp);
      }
    } else {
      this.logger.error(
        `Unhandled error on ${req.method} ${req.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: Record<string, unknown> = {
      type: `https://taxora.id/errors/${code.toLowerCase()}`,
      title,
      status,
      code,
      traceId,
    };
    if (detail) body['detail'] = detail;
    if (fields) body['fields'] = fields;

    void reply.status(status).type('application/problem+json').send(body);
  }
}

function mapStatusToCode(status: number): string {
  switch (status) {
    case 400: return 'BAD_REQUEST';
    case 401: return 'UNAUTHENTICATED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 422: return 'UNPROCESSABLE_ENTITY';
    case 429: return 'RATE_LIMITED';
    default:  return status >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
  }
}

function cryptoRandomId(): string {
  // Only used on the rare path where Fastify didn't tag the request.
  return randomUUID();
}
