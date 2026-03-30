import { normalizeLegacyEvent, normalizeSessionEvent } from './event-normalizer';
import type { SessionEvent } from './session-types';
import { appendUnifiedEvent } from './unified-event-store';
import type { UnifiedActorType, UnifiedEntityType, UnifiedEvent, UnifiedEventSource } from './event-types';

type LegacyBridgeInput = {
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

type SessionBridgeInput = {
  tenantId: string;
  sessionId: string;
  runnerId?: string | null;
  event: SessionEvent;
  source?: UnifiedEventSource;
  correlationId?: string | null;
  causationId?: string | null;
};

export async function emitUnifiedEvent(db: D1Database, event: UnifiedEvent): Promise<UnifiedEvent> {
  return appendUnifiedEvent(db, event);
}

export async function bridgeLegacyEvent(db: D1Database, input: LegacyBridgeInput): Promise<UnifiedEvent[]> {
  const events = normalizeLegacyEvent(input);
  const appended: UnifiedEvent[] = [];
  for (const event of events) {
    appended.push(await emitUnifiedEvent(db, event));
  }
  return appended;
}

export async function bridgeSessionEvent(db: D1Database, input: SessionBridgeInput): Promise<UnifiedEvent[]> {
  const events = normalizeSessionEvent(input);
  const appended: UnifiedEvent[] = [];
  for (const event of events) {
    appended.push(await emitUnifiedEvent(db, event));
  }
  return appended;
}
