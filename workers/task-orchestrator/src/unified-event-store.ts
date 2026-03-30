import type { UnifiedEvent } from './event-types';

function safeParse(value: string | null | undefined, fallback: Record<string, unknown> = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeRow(row: any): UnifiedEvent {
  return {
    eventId: row.event_id,
    tenantId: row.tenant_id,
    streamId: row.stream_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    eventType: row.event_type,
    actorType: row.actor_type,
    actorId: row.actor_id ?? null,
    timestamp: Number(row.timestamp_ms ?? 0) || Date.now(),
    payload: safeParse(row.payload_json),
    source: row.source,
    legacyType: row.legacy_type ?? null,
    causationId: row.causation_id ?? null,
    correlationId: row.correlation_id ?? null,
  };
}

export async function appendUnifiedEvent(db: D1Database, event: UnifiedEvent): Promise<UnifiedEvent> {
  await db
    .prepare(
      `INSERT INTO nuxon_unified_events (
        event_id, tenant_id, stream_id, entity_type, entity_id, event_type, actor_type, actor_id, timestamp_ms, payload_json, source, legacy_type, causation_id, correlation_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`
    )
    .bind(
      event.eventId,
      event.tenantId,
      event.streamId,
      event.entityType,
      event.entityId,
      event.eventType,
      event.actorType,
      event.actorId ?? null,
      event.timestamp,
      JSON.stringify(event.payload ?? {}),
      event.source,
      event.legacyType ?? null,
      event.causationId ?? null,
      event.correlationId ?? null,
    )
    .run();
  return event;
}

export async function listUnifiedEvents(
  db: D1Database,
  {
    tenantId,
    limit = 100,
  }: {
    tenantId: string;
    limit?: number;
  },
): Promise<UnifiedEvent[]> {
  const result = await db
    .prepare(
      `SELECT *
       FROM nuxon_unified_events
       WHERE tenant_id = ?
       ORDER BY timestamp_ms ASC, created_at ASC
       LIMIT ?`
    )
    .bind(tenantId, limit)
    .all();
  return (result.results ?? []).map(normalizeRow);
}

export async function listUnifiedEventsByStream(
  db: D1Database,
  {
    tenantId,
    streamId,
    limit = 200,
  }: {
    tenantId: string;
    streamId: string;
    limit?: number;
  },
): Promise<UnifiedEvent[]> {
  const result = await db
    .prepare(
      `SELECT *
       FROM nuxon_unified_events
       WHERE tenant_id = ?
         AND stream_id = ?
       ORDER BY timestamp_ms ASC, created_at ASC
       LIMIT ?`
    )
    .bind(tenantId, streamId, limit)
    .all();
  return (result.results ?? []).map(normalizeRow);
}
