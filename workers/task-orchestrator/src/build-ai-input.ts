import type { SemanticSlot, SessionEvent, SessionState } from './session-types';

const IMPORTANT_SLOTS = new Set([
  'user_goal',
  'runner_mode',
  'needs_persistence',
  'approval_required',
  'current_repo',
  'resume_strategy',
]);

const IMPORTANT_EVENT_TYPES = new Set([
  'session.initialized',
  'session.resumed',
  'runner.attached',
  'conversation.attached',
  'task.created',
  'approval.requested',
  'approval.granted',
  'task.started',
  'task.succeeded',
  'task.failed',
  'checkpoint.saved',
]);

export function buildAiInput({
  state,
  slots,
  events,
}: {
  state: SessionState;
  slots: SemanticSlot[];
  events: SessionEvent[];
}) {
  const compactSlots = slots
    .filter((slot) => IMPORTANT_SLOTS.has(slot.key))
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((slot) => ({
      key: slot.key,
      value: slot.value,
      confidence: slot.confidence ?? null,
      updatedAt: slot.updatedAt,
      sourceEventId: slot.sourceEventId ?? null,
    }));

  const recentEvents = events
    .filter((event) => IMPORTANT_EVENT_TYPES.has(event.type))
    .slice(-12)
    .map((event) => ({
      eventId: event.eventId,
      type: event.type,
      actor: event.actor,
      timestamp: event.timestamp,
      payload: event.payload,
    }));

  return {
    session: {
      sessionId: state.sessionId,
      tenantId: state.tenantId,
      runnerId: state.runnerId,
      provider: state.provider,
      phase: state.phase,
      repo: state.repo ?? null,
      branch: state.branch ?? null,
      cwd: state.cwd ?? null,
      goal: state.goal ?? null,
      summary: state.summary ?? null,
      lastTaskId: state.lastTaskId ?? null,
      lastUserIntent: state.lastUserIntent ?? null,
      lastCheckpointAt: state.lastCheckpointAt ?? null,
      updatedAt: state.updatedAt,
    },
    compactSlots,
    recentEvents,
  };
}
