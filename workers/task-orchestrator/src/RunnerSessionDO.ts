import { SessionStore } from './session-store';
import { bridgeSessionEvent } from './event-bridge';
import type { SemanticSlot, SessionActorKind, SessionCheckpoint, SessionEvent, SessionPhase, SessionState } from './session-types';

type DurableObjectStateLike = {
  storage: {
    get: <T = unknown>(key: string) => Promise<T | undefined>;
    put: (key: string, value: unknown) => Promise<void>;
  };
};

type DurableObjectEnvLike = {
  DB?: D1Database;
};

function nowIso() {
  return new Date().toISOString();
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeEventId(sessionId: string) {
  return `${sessionId}-evt-${Math.random().toString(16).slice(2, 10)}`;
}

function ensureTenantMatches(state: SessionState | null, tenantId: string | null) {
  if (!state) return { ok: false, response: json({ error: 'session_not_found', code: 'session_not_found' }, 404) };
  if (!tenantId || state.tenantId !== tenantId) {
    return { ok: false, response: json({ error: 'session_not_found', code: 'session_not_found' }, 404) };
  }
  return { ok: true as const };
}

function defaultSlotsFromState(state: SessionState): SemanticSlot[] {
  const timestamp = state.updatedAt;
  return [
    { key: 'user_goal', value: state.goal ?? null, updatedAt: timestamp, sourceEventId: null },
    { key: 'current_repo', value: state.repo ?? null, updatedAt: timestamp, sourceEventId: null },
    { key: 'runner_mode', value: 'local', updatedAt: timestamp, sourceEventId: null },
    { key: 'approval_required', value: false, updatedAt: timestamp, sourceEventId: null },
    { key: 'resume_strategy', value: 'session_checkpoint', updatedAt: timestamp, sourceEventId: null },
    { key: 'needs_persistence', value: true, updatedAt: timestamp, sourceEventId: null },
  ];
}

function mergeState(state: SessionState, patch: Partial<SessionState>): SessionState {
  return {
    ...state,
    ...patch,
    updatedAt: patch.updatedAt ?? nowIso(),
  };
}

function phaseForLifecycleEvent(type: string, payload: Record<string, unknown>, current: SessionState): SessionPhase {
  if (typeof payload.phase === 'string') return payload.phase as SessionPhase;
  switch (type) {
    case 'session.resumed':
    case 'runner.attached':
    case 'conversation.attached':
      return 'attached';
    case 'task.created':
      return payload.approval_required ? 'awaiting_approval' : 'running';
    case 'approval.requested':
      return 'awaiting_approval';
    case 'approval.granted':
    case 'task.started':
      return 'running';
    case 'task.succeeded':
      return 'completed';
    case 'task.failed':
      return 'failed';
    case 'approval.rejected':
    case 'task.cancelled':
      return 'blocked';
    default:
      return current.phase;
  }
}

function slotPatchFromEvent(event: SessionEvent): Array<Pick<SemanticSlot, 'key' | 'value' | 'confidence'>> {
  switch (event.type) {
    case 'session.initialized':
      return [
        { key: 'runner_mode', value: event.payload.runner_mode ?? 'local' },
        { key: 'resume_strategy', value: 'session_checkpoint' },
        { key: 'needs_persistence', value: true },
      ];
    case 'session.resumed':
      return [{ key: 'resume_strategy', value: 'session_checkpoint' }];
    case 'task.created':
      return [
        { key: 'user_goal', value: event.payload.input ?? event.payload.summary ?? null },
        { key: 'approval_required', value: Boolean(event.payload.approval_required) },
      ];
    case 'approval.requested':
      return [{ key: 'approval_required', value: true }];
    case 'approval.granted':
      return [{ key: 'approval_required', value: false }];
    case 'task.succeeded':
    case 'task.failed':
    case 'task.cancelled':
      return [{ key: 'approval_required', value: false }];
    default:
      return [];
  }
}

async function applyLifecycleEffects(store: SessionStore, current: SessionState, event: SessionEvent) {
  const patch: Partial<SessionState> = {
    phase: phaseForLifecycleEvent(event.type, event.payload, current),
    summary: (event.payload.summary as string | undefined) ?? current.summary ?? null,
    lastTaskId: (event.payload.taskId as string | undefined) ?? (event.payload.task_id as string | undefined) ?? current.lastTaskId ?? null,
    lastUserIntent:
      (event.payload.input as string | undefined) ??
      (event.payload.user_intent as string | undefined) ??
      current.lastUserIntent ??
      null,
  };

  if (event.type === 'checkpoint.saved') {
    patch.lastCheckpointAt = event.timestamp;
  }
  if (typeof event.payload.repo === 'string') patch.repo = event.payload.repo;
  if (typeof event.payload.branch === 'string') patch.branch = event.payload.branch;
  if (typeof event.payload.cwd === 'string') patch.cwd = event.payload.cwd;

  const nextState = mergeState(current, patch);
  await store.putSessionState(nextState);

  for (const slot of slotPatchFromEvent(event)) {
    await store.upsertSemanticSlot({
      key: slot.key,
      value: slot.value,
      confidence: slot.confidence ?? null,
      updatedAt: event.timestamp,
      sourceEventId: event.eventId,
    });
  }

  const payloadSlots = Array.isArray(event.payload.slots) ? event.payload.slots : [];
  for (const slot of payloadSlots) {
    if (!slot || typeof slot !== 'object') continue;
    await store.upsertSemanticSlot({
      key: String((slot as Record<string, unknown>).key ?? ''),
      value: (slot as Record<string, unknown>).value,
      confidence: Number((slot as Record<string, unknown>).confidence ?? 0) || null,
      updatedAt: event.timestamp,
      sourceEventId: event.eventId,
    });
  }
}

function buildCheckpoint(state: SessionState, slots: SemanticSlot[], events: SessionEvent[]): SessionCheckpoint {
  return {
    sessionId: state.sessionId,
    tenantId: state.tenantId,
    runnerId: state.runnerId,
    repo: state.repo ?? null,
    branch: state.branch ?? null,
    cwd: state.cwd ?? null,
    phase: state.phase,
    summary: state.summary ?? null,
    slots,
    lastEventId: events.length ? events[events.length - 1].eventId : null,
    updatedAt: nowIso(),
  };
}

export class RunnerSessionDO {
  private readonly store: SessionStore;

  constructor(private readonly state: DurableObjectStateLike, private readonly env?: DurableObjectEnvLike) {
    this.store = new SessionStore(state.storage);
  }

  private async appendUnifiedSessionEvent(event: SessionEvent) {
    if (!this.env?.DB) return;
    const current = await this.store.getSessionState();
    await bridgeSessionEvent(this.env.DB, {
      tenantId: event.tenantId,
      sessionId: event.sessionId,
      runnerId: current?.runnerId ?? null,
      event,
    });
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const tenantId = request.headers.get('x-session-tenant-id');

    if (request.method === 'POST' && path === '/state/init') {
      const body = (await request.json().catch(() => ({}))) as Partial<SessionState>;
      const existing = await this.store.getSessionState();
      if (existing) {
        const scoped = ensureTenantMatches(existing, tenantId);
        if (!scoped.ok) return scoped.response;
        return json({ ok: true, initialized: false, state: existing, slots: await this.store.getSemanticSlots() });
      }
      const timestamp = nowIso();
      const nextState: SessionState = {
        sessionId: String(body.sessionId ?? ''),
        tenantId: String(body.tenantId ?? tenantId ?? 'default'),
        runnerId: String(body.runnerId ?? 'runner-unbound'),
        containerId: (body.containerId as string | null | undefined) ?? null,
        provider: 'codex',
        phase: (body.phase as SessionPhase | undefined) ?? 'idle',
        repo: (body.repo as string | null | undefined) ?? null,
        branch: (body.branch as string | null | undefined) ?? null,
        cwd: (body.cwd as string | null | undefined) ?? null,
        goal: (body.goal as string | null | undefined) ?? null,
        summary: (body.summary as string | null | undefined) ?? null,
        lastTaskId: (body.lastTaskId as string | null | undefined) ?? null,
        lastUserIntent: (body.lastUserIntent as string | null | undefined) ?? null,
        lastCheckpointAt: null,
        updatedAt: timestamp,
        createdAt: timestamp,
      };
      await this.store.putSessionState(nextState);
      for (const slot of defaultSlotsFromState(nextState)) {
        await this.store.upsertSemanticSlot(slot);
      }
      const event: SessionEvent = {
        eventId: makeEventId(nextState.sessionId),
        sessionId: nextState.sessionId,
        tenantId: nextState.tenantId,
        type: 'session.initialized',
        actor: 'system',
        timestamp,
        payload: {
          runner_mode: 'local',
          goal: nextState.goal,
          summary: nextState.summary,
        },
      };
      await this.store.appendEvent(event);
      await applyLifecycleEffects(this.store, nextState, event);
      await this.appendUnifiedSessionEvent(event);
      return json({ ok: true, initialized: true, state: await this.store.getSessionState(), slots: await this.store.getSemanticSlots() });
    }

    const current = await this.store.getSessionState();
    const scoped = ensureTenantMatches(current, tenantId);
    if (!scoped.ok) return scoped.response;

    if (request.method === 'GET' && path === '/state') {
      return json({ ok: true, state: current, slots: await this.store.getSemanticSlots() });
    }

    if (request.method === 'POST' && path === '/state/merge') {
      const body = (await request.json().catch(() => ({}))) as { patch?: Partial<SessionState> };
      const nextState = mergeState(current!, body.patch ?? {});
      await this.store.putSessionState(nextState);
      return json({ ok: true, state: nextState, slots: await this.store.getSemanticSlots() });
    }

    if (request.method === 'POST' && path === '/slots/upsert') {
      const body = (await request.json().catch(() => ({}))) as Partial<SemanticSlot>;
      if (!body.key) return json({ error: 'slot_key_required', code: 'slot_key_required' }, 400);
      const slots = await this.store.upsertSemanticSlot({
        key: String(body.key),
        value: body.value,
        confidence: body.confidence ?? null,
        updatedAt: nowIso(),
        sourceEventId: body.sourceEventId ?? null,
      });
      return json({ ok: true, slots });
    }

    if (request.method === 'GET' && path === '/events') {
      const limit = Number(url.searchParams.get('limit') ?? 0) || undefined;
      return json({ ok: true, events: await this.store.listEvents(limit) });
    }

    if (request.method === 'POST' && path === '/events/append') {
      const body = (await request.json().catch(() => ({}))) as {
        type?: string;
        actor?: SessionActorKind;
        payload?: Record<string, unknown>;
      };
      if (!body.type) return json({ error: 'event_type_required', code: 'event_type_required' }, 400);
      const event: SessionEvent = {
        eventId: makeEventId(current!.sessionId),
        sessionId: current!.sessionId,
        tenantId: current!.tenantId,
        type: body.type,
        actor: (body.actor as SessionActorKind | undefined) ?? 'system',
        timestamp: nowIso(),
        payload: body.payload ?? {},
      };
      await this.store.appendEvent(event);
      await applyLifecycleEffects(this.store, current!, event);
      await this.appendUnifiedSessionEvent(event);
      return json({ ok: true, event, state: await this.store.getSessionState(), slots: await this.store.getSemanticSlots() });
    }

    if (request.method === 'POST' && path === '/checkpoint/save') {
      const state = await this.store.getSessionState();
      const slots = await this.store.getSemanticSlots();
      const events = await this.store.listEvents(50);
      const checkpoint = buildCheckpoint(state!, slots, events);
      await this.store.putCheckpoint(checkpoint);
      const checkpointEvent: SessionEvent = {
        eventId: makeEventId(state!.sessionId),
        sessionId: state!.sessionId,
        tenantId: state!.tenantId,
        type: 'checkpoint.saved',
        actor: 'system',
        timestamp: checkpoint.updatedAt,
        payload: {
          summary: state!.summary ?? null,
          lastEventId: checkpoint.lastEventId ?? null,
        },
      };
      await this.store.appendEvent(checkpointEvent);
      await applyLifecycleEffects(this.store, state!, checkpointEvent);
      await this.appendUnifiedSessionEvent(checkpointEvent);
      return json({ ok: true, checkpoint, state: await this.store.getSessionState() });
    }

    if (request.method === 'GET' && path === '/checkpoint') {
      return json({ ok: true, checkpoint: await this.store.getCheckpoint() });
    }

    return json({ error: 'not_found', code: 'not_found' }, 404);
  }
}
