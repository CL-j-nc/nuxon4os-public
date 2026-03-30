export type SessionPhase =
  | 'idle'
  | 'provisioning'
  | 'attached'
  | 'awaiting_approval'
  | 'running'
  | 'blocked'
  | 'sleeping'
  | 'completed'
  | 'failed';

export type SessionActorKind = 'user' | 'runner' | 'system' | 'ai';

export interface SessionState {
  sessionId: string;
  tenantId: string;
  runnerId: string;
  containerId?: string | null;
  provider: 'codex';
  phase: SessionPhase;
  repo?: string | null;
  branch?: string | null;
  cwd?: string | null;
  goal?: string | null;
  summary?: string | null;
  lastTaskId?: string | null;
  lastUserIntent?: string | null;
  lastCheckpointAt?: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface SemanticSlot {
  key: string;
  value: unknown;
  confidence?: number | null;
  updatedAt: string;
  sourceEventId?: string | null;
}

export interface SessionEvent {
  eventId: string;
  sessionId: string;
  tenantId: string;
  type: string;
  actor: SessionActorKind;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface SessionCheckpoint {
  sessionId: string;
  tenantId: string;
  runnerId: string;
  repo?: string | null;
  branch?: string | null;
  cwd?: string | null;
  phase: SessionPhase;
  summary?: string | null;
  slots: SemanticSlot[];
  lastEventId?: string | null;
  updatedAt: string;
}
