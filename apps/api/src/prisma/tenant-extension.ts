import { Prisma } from '@prisma/client';
import { getTenantContext, isUnscoped } from './tenant-context';

/**
 * Automatic company scoping.
 *
 * Every model with a `companyId` column gets it injected into the `where` of
 * every read and write, and into the `data` of every create. Nothing may bypass
 * it: a query that runs with no tenant context and no explicit `runUnscoped()`
 * throws rather than returning another company's rows.
 *
 * The model list is derived from the generated DMMF, so adding a table with a
 * `companyId` column is enough — there is no list to keep in step.
 *
 * `companyId` can be merged into `where` even for `findUnique`, `update` and
 * `delete` because Prisma 5 made non-unique filters alongside a unique selector
 * generally available. A row belonging to another company therefore simply does
 * not match, with no extra round trip to find that out.
 */
const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((f) => f.name === 'companyId'))
    .map((model) => model.name),
);

/** Deliberately global: the permission catalogue and the Company row itself. */
const GLOBAL_MODELS: ReadonlySet<string> = new Set(['Permission', 'Company']);

export const scopedModelNames: string[] = [...TENANT_MODELS]
  .filter((m) => !GLOBAL_MODELS.has(m))
  .sort();

const SCOPED = new Set(scopedModelNames);

export class MissingTenantContextError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model}.${operation} ran with no tenant context. Wrap request work in runInTenantContext(), or runUnscoped() for infrastructure.`,
    );
    this.name = 'MissingTenantContextError';
  }
}

/** Operations whose `where` must carry the company filter. */
const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

/** Operations whose payload must carry the company id. */
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);

type Args = Record<string, unknown>;

function withCompanyInWhere(args: Args, companyId: string): Args {
  const where = (args.where ?? {}) as Record<string, unknown>;
  return { ...args, where: { ...where, companyId } };
}

function withCompanyInData(data: unknown, companyId: string): unknown {
  if (Array.isArray(data)) {
    return data.map((row) => ({ ...(row as Record<string, unknown>), companyId }));
  }
  return { ...(data as Record<string, unknown>), companyId };
}

export const tenantExtension = Prisma.defineExtension({
  name: 'opsvera-tenant-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!model || !SCOPED.has(model) || isUnscoped()) {
          return query(args);
        }

        const context = getTenantContext();
        if (!context) {
          throw new MissingTenantContextError(model, operation);
        }
        const { companyId } = context;
        let next = (args ?? {}) as Args;

        if (WHERE_OPS.has(operation)) {
          next = withCompanyInWhere(next, companyId);
        }

        if (CREATE_OPS.has(operation)) {
          next = { ...next, data: withCompanyInData(next.data, companyId) };
        }

        // upsert writes on the create path and filters on the update path.
        if (operation === 'upsert') {
          next = { ...next, create: withCompanyInData(next.create, companyId) };
        }

        return query(next as never);
      },
    },
  },
});
