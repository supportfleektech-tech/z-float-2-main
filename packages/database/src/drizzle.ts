/**
 * Re-export of the drizzle-orm query surface so ALL consumers (web app, worker,
 * packages) use the exact same physical drizzle-orm instance as the schema —
 * this avoids duplicate-instance type identity errors in a pnpm monorepo.
 */
export {
  sql,
  eq,
  ne,
  and,
  or,
  not,
  asc,
  desc,
  gt,
  gte,
  lt,
  lte,
  isNull,
  isNotNull,
  inArray,
  notInArray,
  ilike,
  count,
  sum,
  min,
  max,
  avg,
} from "drizzle-orm";

export type { SQL, SQLWrapper, SQLChunk } from "drizzle-orm";
