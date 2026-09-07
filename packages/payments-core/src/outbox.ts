/**
 * Outbox pattern: domain events are written to outbox_events in the SAME
 * transaction as the state change, then a dispatcher publishes them to the
 * queue/notifications. No event is ever emitted that wasn't durably committed.
 */
import { eq, isNull, and, sql } from "drizzle-orm";
import { schema, toJsonSafe, type Db, type Tx } from "@zfloat/database";

export interface OutboxEvent {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  tenantId?: string;
  payload: Record<string, unknown>;
}

export async function enqueueOutbox(tx: Tx, event: OutboxEvent): Promise<string> {
  const [row] = await tx
    .insert(schema.outboxEvents)
    .values({
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      tenantId: event.tenantId,
      payload: toJsonSafe(event.payload) as Record<string, unknown>,
    })
    .returning({ id: schema.outboxEvents.id });
  return row!.id;
}

/** Mark an event published. */
export async function markPublished(db: Db, eventId: string): Promise<void> {
  await db
    .update(schema.outboxEvents)
    .set({ publishedAt: new Date() })
    .where(eq(schema.outboxEvents.id, eventId));
}

export async function markFailed(db: Db, eventId: string, error: string): Promise<void> {
  await db
    .update(schema.outboxEvents)
    .set({ attempts: sql`${schema.outboxEvents.attempts} + 1`, lastError: error.slice(0, 500) })
    .where(eq(schema.outboxEvents.id, eventId));
}

/** Pull unpublished events (for the dispatcher worker). */
export async function pullUnpublished(db: Db, limit = 100): Promise<Array<typeof schema.outboxEvents.$inferSelect>> {
  return db
    .select()
    .from(schema.outboxEvents)
    .where(and(isNull(schema.outboxEvents.publishedAt), sql`${schema.outboxEvents.attempts} < 10`))
    .orderBy(schema.outboxEvents.createdAt)
    .limit(limit);
}
