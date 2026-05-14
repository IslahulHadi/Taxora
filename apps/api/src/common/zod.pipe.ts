import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Bridges Zod schemas into NestJS validation.
 *
 * Usage:
 *   @Body(new ZodValidationPipe(CreateInvoiceInput)) body
 *
 * Why: NestJS' default class-validator stack requires decorators on DTO classes.
 * Zod schemas are plain values, share-able with the web client (apps/web), and
 * can derive OpenAPI later. We standardize on Zod across the stack.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      // RFC 7807-flavored payload — the global filter consumes `fields` if present.
      const fields = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        title: 'Request validation failed',
        fields,
      });
    }
    return result.data;
  }
}
