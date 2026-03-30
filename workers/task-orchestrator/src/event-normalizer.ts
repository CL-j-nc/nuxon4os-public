import type { SessionEvent } from './session-types';
import { buildStreamId, nowTimestampMs, parseStreamId, type UnifiedActorType, type UnifiedEntityType, type UnifiedEvent, type UnifiedEventSource } from './event-types';

function makeEventId(prefix = 'uevt') {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function toTimestampMs(input?: number | string | null): number {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'string' && input.trim()) {
    const parsed = Date.parse(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return nowTimestampMs();
}

function coerceActorType(value: unknown, fallback: UnifiedActorType = 'system'): UnifiedActorType {
  if (value === 'user' || value === 'runner' || value === 'system' || value === 'ai' || value === 'container') {
    return value;
  }
  return fallback;
}

function inferEntity(entityType: UnifiedEntityType | undefined, entityId: string | undefined, streamId?: string | null) {
  if (entityType && entityId) return { entityType, entityId };
  if (streamId) {
    const parsed = parseStreamId(streamId);
    if (parsed.entityId) return parsed;
  }
  return {
    entityType: (entityType ?? 'system') as UnifiedEntityType,
    entityId: entityId ?? 'global',
  };
}

function createUnifiedEvent(
  base: Omit<UnifiedEvent, 'eventId' | 'timestamp'> & { eventId?: string | null; timestamp?: number | string | null },
): UnifiedEvent {
  const stream = base.streamId?.trim()
    ? base.streamId
    : buildStreamId(base.entityType, base.entityId);
  const entity = inferEntity(base.entityType, base.entityId, stream);
  return {
    eventId: base.eventId?.trim() || makeEventId(entity.entityType),
    tenantId: base.tenantId,
    streamId: stream,
    entityType: entity.entityType,
    entityId: entity.entityId,
    eventType: base.eventType,
    actorType: coerceActorType(base.actorType),
    actorId: base.actorId ?? null,
    timestamp: toTimestampMs(base.timestamp),
    payload: base.payload ?? {},
    source: base.source,
    legacyType: base.legacyType ?? null,
    causationId: base.causationId ?? null,
    correlationId: base.correlationId ?? null,
  };
}

type LegacyNormalizeInput = {
  tenantId: string;
  legacyType: string;
  payload?: Record<string, unknown>;
  source?: UnifiedEventSource;
  actorType?: UnifiedActorType;
  actorId?: string | null;
  timestamp?: number | string | null;
  sessionId?: string | null;
  conversationId?: string | null;
  runnerId?: string | null;
  taskId?: string | null;
  streamId?: string | null;
  entityType?: UnifiedEntityType;
  entityId?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
};

type SessionNormalizeInput = {
  tenantId: string;
  sessionId: string;
  runnerId?: string | null;
  event: SessionEvent;
  source?: UnifiedEventSource;
  correlationId?: string | null;
  causationId?: string | null;
};

function buildLegacyBase(input: LegacyNormalizeInput) {
  const payload = input.payload ?? {};
  return {
    tenantId: input.tenantId,
    payload,
    source: input.source ?? 'legacy',
    actorType: coerceActorType(input.actorType ?? payload.actor_type ?? payload.actor, 'system'),
    actorId:
      input.actorId ??
      (typeof payload.actor_id === 'string' ? payload.actor_id : null) ??
      (typeof payload.actor === 'string' ? payload.actor : null),
    timestamp: input.timestamp ?? (typeof payload.timestamp === 'string' ? payload.timestamp : null),
    correlationId:
      input.correlationId ??
      (typeof payload.correlationId === 'string' ? payload.correlationId : null) ??
      (typeof payload.correlation_id === 'string' ? payload.correlation_id : null) ??
      input.taskId ??
      input.sessionId ??
      input.conversationId ??
      input.runnerId ??
      null,
    causationId:
      input.causationId ??
      (typeof payload.causationId === 'string' ? payload.causationId : null) ??
      (typeof payload.causation_id === 'string' ? payload.causation_id : null) ??
      null,
  };
}

export function normalizeLegacyEvent(input: LegacyNormalizeInput): UnifiedEvent[] {
  const base = buildLegacyBase(input);
  const legacyType = String(input.legacyType ?? '').trim();
  const lower = legacyType.toLowerCase();

  if (lower === 'continue_conversation_succeeded' || lower === 'conversation.continued' || lower === 'tentacle.continue.succeeded') {
    const sessionId = input.sessionId ?? input.conversationId ?? input.entityId ?? 'unknown';
    const conversationId = input.conversationId ?? input.sessionId ?? input.entityId ?? 'unknown';
    return [
      createUnifiedEvent({
        ...base,
        streamId: buildStreamId('session', sessionId),
        entityType: 'session',
        entityId: sessionId,
        eventType: 'session.resumed',
        legacyType,
      }),
      createUnifiedEvent({
        ...base,
        streamId: buildStreamId('conversation', conversationId),
        entityType: 'conversation',
        entityId: conversationId,
        eventType: 'conversation.attached',
        legacyType,
      }),
    ];
  }

  const mappings: Record<string, { eventType: string; entityType?: UnifiedEntityType; entityId?: string | null; streamId?: string | null; actorType?: UnifiedActorType }> = {
    approval_requested: { eventType: 'approval.requested', entityType: 'approval', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'runner' },
    'approval.required': { eventType: 'approval.requested', entityType: 'approval', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'runner' },
    approval_required: { eventType: 'approval.requested', entityType: 'approval', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'runner' },
    approval_required_event: { eventType: 'approval.requested', entityType: 'approval', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'runner' },
    'approval.granted': { eventType: 'approval.granted', entityType: 'approval', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'user' },
    approval_granted: { eventType: 'approval.granted', entityType: 'approval', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'user' },
    'approval.rejected': { eventType: 'approval.rejected', entityType: 'approval', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'user' },
    approval_rejected: { eventType: 'approval.rejected', entityType: 'approval', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'user' },
    'task.created': { eventType: 'task.created', entityType: 'task', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'user' },
    task_created: { eventType: 'task.created', entityType: 'task', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'user' },
    'task.started': { eventType: 'task.started', entityType: 'task', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'runner' },
    task_started: { eventType: 'task.started', entityType: 'task', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'runner' },
    'task.succeeded': { eventType: 'task.succeeded', entityType: 'task', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'runner' },
    task_succeeded: { eventType: 'task.succeeded', entityType: 'task', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'runner' },
    'task.failed': { eventType: 'task.failed', entityType: 'task', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'runner' },
    task_failed: { eventType: 'task.failed', entityType: 'task', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'runner' },
    'task.cancelled': { eventType: 'task.cancelled', entityType: 'task', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'user' },
    task_cancelled: { eventType: 'task.cancelled', entityType: 'task', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'user' },
    retry_requested: { eventType: 'task.retry.requested', entityType: 'task', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'user' },
    'runner.connected': { eventType: 'runner.connected', entityType: 'runner', entityId: input.runnerId, streamId: input.runnerId ? buildStreamId('runner', input.runnerId) : input.streamId, actorType: 'runner' },
    runner_connected: { eventType: 'runner.connected', entityType: 'runner', entityId: input.runnerId, streamId: input.runnerId ? buildStreamId('runner', input.runnerId) : input.streamId, actorType: 'runner' },
    'tentacle.connected': { eventType: 'runner.connected', entityType: 'runner', entityId: input.runnerId, streamId: input.runnerId ? buildStreamId('runner', input.runnerId) : input.streamId, actorType: 'runner' },
    tentacle_connected: { eventType: 'runner.connected', entityType: 'runner', entityId: input.runnerId, streamId: input.runnerId ? buildStreamId('runner', input.runnerId) : input.streamId, actorType: 'runner' },
    'runner.disconnected': { eventType: 'runner.disconnected', entityType: 'runner', entityId: input.runnerId, streamId: input.runnerId ? buildStreamId('runner', input.runnerId) : input.streamId, actorType: 'runner' },
    runner_disconnected: { eventType: 'runner.disconnected', entityType: 'runner', entityId: input.runnerId, streamId: input.runnerId ? buildStreamId('runner', input.runnerId) : input.streamId, actorType: 'runner' },
    'tentacle.disconnected': { eventType: 'runner.disconnected', entityType: 'runner', entityId: input.runnerId, streamId: input.runnerId ? buildStreamId('runner', input.runnerId) : input.streamId, actorType: 'runner' },
    tentacle_disconnected: { eventType: 'runner.disconnected', entityType: 'runner', entityId: input.runnerId, streamId: input.runnerId ? buildStreamId('runner', input.runnerId) : input.streamId, actorType: 'runner' },
    task_dispatched: { eventType: 'task.started', entityType: 'task', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'runner' },
    run_succeeded: { eventType: 'task.succeeded', entityType: 'task', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'runner' },
    run_failed: { eventType: 'task.failed', entityType: 'task', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'runner' },
    run_cancelled: { eventType: 'task.cancelled', entityType: 'task', entityId: input.taskId, streamId: input.taskId ? buildStreamId('task', input.taskId) : input.streamId, actorType: 'user' },
  };

  const key = lower.replace(/[ -]/g, '_');
  const mapped = mappings[key];
  if (!mapped) {
    return [
      createUnifiedEvent({
        ...base,
        streamId: input.streamId ?? buildStreamId(input.entityType ?? 'system', input.entityId ?? 'global'),
        entityType: input.entityType ?? 'system',
        entityId: input.entityId ?? 'global',
        eventType: legacyType || 'legacy.unknown',
        legacyType: legacyType || null,
      }),
    ];
  }

  return [
    createUnifiedEvent({
      ...base,
      streamId: mapped.streamId ?? input.streamId ?? buildStreamId(mapped.entityType ?? input.entityType ?? 'system', mapped.entityId ?? input.entityId ?? 'global'),
      entityType: mapped.entityType ?? input.entityType ?? 'system',
      entityId: mapped.entityId ?? input.entityId ?? 'global',
      eventType: mapped.eventType,
      actorType: input.actorType ?? mapped.actorType ?? base.actorType,
      legacyType,
    }),
  ];
}

export function normalizeSessionEvent(input: SessionNormalizeInput): UnifiedEvent[] {
  const payload = input.event.payload ?? {};
  return [
    createUnifiedEvent({
      tenantId: input.tenantId,
      streamId: buildStreamId('session', input.sessionId),
      entityType:
        input.event.type === 'runner.attached'
          ? 'runner'
          : input.event.type.startsWith('approval.')
            ? 'approval'
            : input.event.type.startsWith('task.')
              ? 'task'
              : input.event.type === 'conversation.attached'
                ? 'conversation'
                : input.event.type === 'checkpoint.saved'
                  ? 'system'
                  : 'session',
      entityId:
        (typeof payload.taskId === 'string' ? payload.taskId : null) ??
        (typeof payload.task_id === 'string' ? payload.task_id : null) ??
        (typeof payload.conversationId === 'string' ? payload.conversationId : null) ??
        (typeof payload.runnerId === 'string' ? payload.runnerId : null) ??
        input.sessionId,
      eventType: input.event.type,
      actorType: coerceActorType(input.event.actor, 'system'),
      actorId:
        (typeof payload.actorId === 'string' ? payload.actorId : null) ??
        (typeof payload.actor_id === 'string' ? payload.actor_id : null) ??
        (input.event.actor === 'runner' ? input.runnerId ?? null : null),
      timestamp: input.event.timestamp,
      payload,
      source: input.source ?? 'session',
      legacyType: null,
      correlationId:
        input.correlationId ??
        (typeof payload.correlationId === 'string' ? payload.correlationId : null) ??
        (typeof payload.correlation_id === 'string' ? payload.correlation_id : null) ??
        (typeof payload.taskId === 'string' ? payload.taskId : null) ??
        (typeof payload.task_id === 'string' ? payload.task_id : null) ??
        input.sessionId,
      causationId:
        input.causationId ??
        (typeof payload.causationId === 'string' ? payload.causationId : null) ??
        (typeof payload.causation_id === 'string' ? payload.causation_id : null) ??
        null,
    }),
  ];
}
