export type UnifiedEntityType = 'session' | 'runner' | 'task' | 'conversation' | 'approval' | 'container' | 'system';

export type UnifiedActorType = 'user' | 'runner' | 'system' | 'ai' | 'container';

export type UnifiedEventSource = 'legacy' | 'session' | 'runner' | 'container' | 'bridge';

export type UnifiedEvent = {
  eventId: string;
  tenantId: string;
  streamId: string;
  entityType: UnifiedEntityType;
  entityId: string;
  eventType: string;
  actorType: UnifiedActorType;
  actorId?: string | null;
  timestamp: number;
  payload: Record<string, unknown>;
  source: UnifiedEventSource;
  legacyType?: string | null;
  causationId?: string | null;
  correlationId?: string | null;
};

export const FUTURE_UNIFIED_EVENT_TYPES = [
  'runner.requested',
  'runner.provisioning',
  'runner.ready',
  'runner.exec.started',
  'runner.exec.succeeded',
  'runner.exec.failed',
  'container.started',
  'container.stopped',
  'container.sleeping',
  'container.resumed',
] as const;

export function buildStreamId(entityType: UnifiedEntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}

export function parseStreamId(streamId: string): { entityType: UnifiedEntityType; entityId: string } {
  const [rawEntityType, ...rest] = String(streamId ?? '').split(':');
  const entityId = rest.join(':');
  const entityType = (rawEntityType || 'system') as UnifiedEntityType;
  return {
    entityType,
    entityId,
  };
}

export function nowTimestampMs(): number {
  return Date.now();
}
