import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { FastifyRequest } from 'fastify';
import { runWithTenant, type TenantStore } from './tenant.context.js';

/**
 * Companion to TenantGuard: wraps the controller method invocation in
 * AsyncLocalStorage so `requireTenantId()` works anywhere downstream.
 *
 * Why split into guard + interceptor:
 *   - Guards verify and reject (synchronous decision); they cannot keep an
 *     ALS frame alive across the async controller body.
 *   - Interceptors CAN wrap the call, which is exactly what we need here.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { tenantStore?: TenantStore }>();
    const store = req.tenantStore;
    if (!store) {
      return next.handle();
    }
    // Wrap the entire downstream observable in the ALS frame.
    return from(
      Promise.resolve().then(
        () => runWithTenant(store, () => firstValueFromObservable(next.handle())),
      ),
    ).pipe(switchMap((v) => from(Promise.resolve(v))));
  }
}

/**
 * Tiny helper to convert an Observable's first emission into a Promise without
 * pulling in rxjs/firstValueFrom (keeps deps small). NestJS controllers
 * generally emit a single value, so this is safe.
 */
function firstValueFromObservable<T>(obs: Observable<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let resolved = false;
    const sub = obs.subscribe({
      next: (v) => {
        if (!resolved) {
          resolved = true;
          resolve(v);
          sub.unsubscribe();
        }
      },
      error: (err) => reject(err),
      complete: () => {
        if (!resolved) reject(new Error('observable completed without emitting'));
      },
    });
  });
}
