import type { SemanticSlot, SessionCheckpoint, SessionEvent, SessionState } from './session-types';

const STATE_KEY = 'session:state';
const SLOTS_KEY = 'session:slots';
const EVENTS_KEY = 'session:events';
const CHECKPOINT_KEY = 'session:checkpoint';
const MAX_EVENTS = 500;

type StorageLike = {
  get: <T = unknown>(key: string) => Promise<T | undefined>;
  put: (key: string, value: unknown) => Promise<void>;
};

export class SessionStore {
  constructor(private readonly storage: StorageLike) {}

  async getSessionState(): Promise<SessionState | null> {
    return (await this.storage.get<SessionState>(STATE_KEY)) ?? null;
  }

  async putSessionState(state: SessionState): Promise<void> {
    await this.storage.put(STATE_KEY, state);
  }

  async getSemanticSlots(): Promise<SemanticSlot[]> {
    return (await this.storage.get<SemanticSlot[]>(SLOTS_KEY)) ?? [];
  }

  async upsertSemanticSlot(slot: SemanticSlot): Promise<SemanticSlot[]> {
    const current = await this.getSemanticSlots();
    const next = current.filter((item) => item.key !== slot.key);
    next.push(slot);
    next.sort((left, right) => left.key.localeCompare(right.key));
    await this.storage.put(SLOTS_KEY, next);
    return next;
  }

  async listEvents(limit?: number): Promise<SessionEvent[]> {
    const events = (await this.storage.get<SessionEvent[]>(EVENTS_KEY)) ?? [];
    if (!limit || limit >= events.length) return events;
    return events.slice(-limit);
  }

  async appendEvent(event: SessionEvent): Promise<SessionEvent[]> {
    const current = await this.listEvents();
    const next = [...current, event].slice(-MAX_EVENTS);
    await this.storage.put(EVENTS_KEY, next);
    return next;
  }

  async getCheckpoint(): Promise<SessionCheckpoint | null> {
    return (await this.storage.get<SessionCheckpoint>(CHECKPOINT_KEY)) ?? null;
  }

  async putCheckpoint(checkpoint: SessionCheckpoint): Promise<void> {
    await this.storage.put(CHECKPOINT_KEY, checkpoint);
  }
}
