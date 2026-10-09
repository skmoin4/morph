import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  companyId: string;
  userId: string;
  employeeId: string | null;
  requestId?: string;
}

/**
 * The store is deliberately mutable.
 *
 * A request opens the scope in middleware, before anything knows who is
 * calling, and the JWT guard fills in the company once the token is verified.
 * Because `storage.run()` captures the *object*, assigning to it inside the
 * guard is visible to everything further down the request — the controller, the
 * services, and the Prisma extension.
 *
 * `enterWith()` cannot do this job: it only applies to the current async
 * resource onwards, and a guard's resolution hands control back to the Express
 * frame before the handler runs, losing the store on the way.
 */
type TenantStore =
  { mode: 'PENDING' } | ({ mode: 'SCOPED' } & TenantContext) | { mode: 'UNSCOPED' };

const storage = new AsyncLocalStorage<TenantStore>();

/**
 * Opens an empty scope for a request. Call this in middleware, so the store
 * object exists before guards run.
 */
export function openRequestScope<T>(fn: () => T): T {
  return storage.run({ mode: 'PENDING' }, fn);
}

/**
 * Fills in the company for the scope opened by `openRequestScope`. Called by
 * the JWT guard once the access token has been verified.
 */
export function attachTenantToRequestScope(context: TenantContext): void {
  const store = storage.getStore();
  if (store) {
    Object.assign(store, { mode: 'SCOPED', ...context });
    return;
  }
  // No middleware-opened scope (a non-HTTP caller): fall back to entering one.
  storage.enterWith({ mode: 'SCOPED', ...context });
}

/**
 * Runs `fn` with every query inside it scoped to one company.
 *
 * `fn` is awaited *inside* the storage scope on purpose. Prisma promises are
 * lazy: the query is only built when the promise is awaited, so handing the
 * promise back out of `storage.run()` would lose the context and the extension
 * would see none.
 */
export function runInTenantContext<T>(
  context: TenantContext,
  fn: () => T | Promise<T>,
): Promise<T> {
  return storage.run({ mode: 'SCOPED', ...context }, async () => await fn());
}

/**
 * Runs `fn` with tenant scoping switched off.
 *
 * Only infrastructure may use this: the seeder, the nightly jobs that
 * legitimately sweep across companies, and login itself, which has to find a
 * user before it knows their company.
 */
export function runUnscoped<T>(fn: () => T | Promise<T>): Promise<T> {
  return storage.run({ mode: 'UNSCOPED' }, async () => await fn());
}

export function getTenantContext(): TenantContext | null {
  const store = storage.getStore();
  if (!store || store.mode !== 'SCOPED') return null;
  const { mode: _mode, ...context } = store;
  return context;
}

export function isUnscoped(): boolean {
  return storage.getStore()?.mode === 'UNSCOPED';
}

/** The company id, or a thrown error — used where a company is mandatory. */
export function requireCompanyId(): string {
  const context = getTenantContext();
  if (!context) {
    throw new Error(
      'No tenant context. A company-scoped query ran outside a request; wrap it in runInTenantContext() or, for infrastructure, runUnscoped().',
    );
  }
  return context.companyId;
}
