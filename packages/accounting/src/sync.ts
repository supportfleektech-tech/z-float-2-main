/**
 * Accounting Sync Engine - Core Types and Interfaces
 * Actual implementation lives in the worker service to avoid TypeScript module resolution issues
 */
import { enqueue } from "@zfloat/queue";
import {
  AccountingSyncType,
  AccountingSyncStatus,
  AccountMapping,
  PaymentSyncData,
  InvoiceSyncData,
  JournalEntrySyncData,
} from "./types.js";

export interface SyncJobPayload {
  correlationId: string;
  tenantId: string;
  connectionId: string;
  syncType: AccountingSyncType;
  entityId?: string;
  entityType?: string;
  triggeredBy?: string;
  [key: string]: unknown;
}

export interface FullSyncJobPayload {
  correlationId: string;
  tenantId: string;
  connectionId: string;
  syncTypes: AccountingSyncType[];
  since?: Date;
  [key: string]: unknown;
}

/** Create a sync log entry - stub, implemented in worker */
export async function createSyncLog(_params: {
  tenantId: string;
  connectionId: string;
  syncType: AccountingSyncType;
  entityId?: string;
  entityType?: string;
  createdById?: string;
}): Promise<string> {
  return crypto.randomUUID();
}

/** Update sync log status - stub, implemented in worker */
export async function updateSyncLog(
  _logId: string,
  _updates: Partial<{
    status: AccountingSyncStatus;
    providerReference: string;
    externalId: string;
    recordsSynced: number;
    recordsFailed: number;
    errors: Array<{ entityId?: string; entityType?: string; code: string; message: string }>;
    requestPayload: Record<string, unknown>;
    responsePayload: Record<string, unknown>;
    completedAt: Date;
    durationMs: number;
  }>,
): Promise<void> {
  // Implemented in worker service
}

/** Enqueue a sync job */
export async function enqueueSync(job: SyncJobPayload): Promise<string> {
  return enqueue("accounting.sync", job, { jobId: `sync-${job.correlationId}` });
}

/** Enqueue a full sync job */
export async function enqueueFullSync(job: FullSyncJobPayload): Promise<string> {
  return enqueue("accounting.sync", job, { jobId: `full-sync-${job.correlationId}` });
}

/** Process a sync job - worker implementation */
export async function processSyncJob(_payload: SyncJobPayload): Promise<void> {
  // Implemented in worker service
}

/** Schedule periodic sync for all active connections - worker implementation */
export async function schedulePeriodicSync(): Promise<void> {
  // Implemented in worker service
}

/** Type guards for payload validation */
export function isSyncJobPayload(payload: unknown): payload is SyncJobPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "correlationId" in payload &&
    "tenantId" in payload &&
    "connectionId" in payload &&
    "syncType" in payload
  );
}

export function isFullSyncJobPayload(payload: unknown): payload is FullSyncJobPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "correlationId" in payload &&
    "tenantId" in payload &&
    "connectionId" in payload &&
    "syncTypes" in payload &&
    Array.isArray((payload as FullSyncJobPayload).syncTypes)
  );
}