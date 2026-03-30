import { emitUnifiedEvent } from './event-bridge';
import { buildStreamId } from './event-types';
import type { RunnerExecRequest, RunnerExecResult, RunnerState } from './runner-types';

type DurableObjectStateLike = {
  storage: {
    get: <T = unknown>(key: string) => Promise<T | undefined>;
    put: (key: string, value: unknown) => Promise<void>;
  };
};

type ContainerBinding = {
  getByName: (name: string) => {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  };
};

type EnvLike = {
  DB: D1Database;
  CODEX_RUNNER_CONTAINER?: ContainerBinding;
};

const STATE_KEY = 'cloud-runner:state';

function nowIso() {
  return new Date().toISOString();
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function toTimestamp(value: string) {
  return Date.parse(value) || Date.now();
}

function buildEventId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function parseJson(request: Request) {
  return request.json().catch(() => ({}));
}

export class CloudRunnerDO {
  constructor(private readonly state: DurableObjectStateLike, private readonly env: EnvLike) {}

  private async getState(): Promise<RunnerState | null> {
    return (await this.state.storage.get<RunnerState>(STATE_KEY)) ?? null;
  }

  private async putState(next: RunnerState): Promise<RunnerState> {
    await this.state.storage.put(STATE_KEY, next);
    return next;
  }

  private async emitRunnerEvent(
    runnerState: RunnerState,
    {
      eventType,
      actorType,
      actorId = null,
      payload = {},
      streamId,
      entityType,
      entityId,
      correlationId = null,
      causationId = null,
      source = 'runner',
    }: {
      eventType: string;
      actorType: 'user' | 'runner' | 'system' | 'ai' | 'container';
      actorId?: string | null;
      payload?: Record<string, unknown>;
      streamId?: string;
      entityType?: 'session' | 'runner' | 'task' | 'conversation' | 'approval' | 'container' | 'system';
      entityId?: string;
      correlationId?: string | null;
      causationId?: string | null;
      source?: 'legacy' | 'session' | 'runner' | 'container' | 'bridge';
    },
  ) {
    await emitUnifiedEvent(this.env.DB, {
      eventId: buildEventId(eventType.replace(/[^a-z0-9]+/gi, '-').toLowerCase()),
      tenantId: runnerState.tenantId,
      streamId: streamId ?? buildStreamId('runner', runnerState.runnerId),
      entityType: entityType ?? 'runner',
      entityId: entityId ?? runnerState.runnerId,
      eventType,
      actorType,
      actorId,
      timestamp: Date.now(),
      payload,
      source,
      legacyType: null,
      correlationId: correlationId ?? runnerState.attachedSessionId ?? runnerState.runnerId,
      causationId,
    });
  }

  private async ensureContainerBinding() {
    if (!this.env.CODEX_RUNNER_CONTAINER) {
      throw new Error('codex_runner_container_binding_missing');
    }
    return this.env.CODEX_RUNNER_CONTAINER;
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'POST' && path === '/init') {
      const body = (await parseJson(request)) as { runnerId?: string; tenantId?: string };
      const runnerId = String(body.runnerId ?? '').trim();
      const tenantId = String(body.tenantId ?? '').trim();
      if (!runnerId || !tenantId) {
        return json({ error: 'runner_id_and_tenant_id_required', code: 'runner_id_and_tenant_id_required' }, 400);
      }
      const existing = await this.getState();
      if (existing) {
        return json({ ok: true, initialized: false, state: existing });
      }
      const timestamp = nowIso();
      const nextState: RunnerState = {
        runnerId,
        tenantId,
        mode: 'cloud',
        provider: 'codex',
        phase: 'provisioning',
        containerId: null,
        attachedSessionId: null,
        lastExecResult: null,
        updatedAt: timestamp,
        createdAt: timestamp,
      };
      await this.putState(nextState);
      await this.emitRunnerEvent(nextState, {
        eventType: 'runner.requested',
        actorType: 'system',
        payload: { runnerId, tenantId, mode: 'cloud', provider: 'codex' },
        correlationId: runnerId,
      });
      await this.emitRunnerEvent(nextState, {
        eventType: 'runner.provisioning',
        actorType: 'system',
        payload: { runnerId, phase: 'provisioning' },
        correlationId: runnerId,
        causationId: runnerId,
      });
      return json({ ok: true, initialized: true, state: nextState });
    }

    const current = await this.getState();
    if (!current) {
      return json({ error: 'runner_not_found', code: 'runner_not_found' }, 404);
    }

    const tenantHeader = request.headers.get('x-runner-tenant-id')?.trim();
    if (!tenantHeader || tenantHeader !== current.tenantId) {
      return json({ error: 'runner_not_found', code: 'runner_not_found' }, 404);
    }

    if (request.method === 'GET' && path === '/state') {
      return json({ ok: true, state: current });
    }

    if (request.method === 'POST' && path === '/attach-session') {
      const body = (await parseJson(request)) as { sessionId?: string; tenantId?: string };
      const sessionId = String(body.sessionId ?? '').trim();
      if (!sessionId) {
        return json({ error: 'session_id_required', code: 'session_id_required' }, 400);
      }
      const updatedState: RunnerState = {
        ...current,
        attachedSessionId: sessionId,
        phase: current.phase === 'failed' ? 'failed' : 'idle',
        updatedAt: nowIso(),
      };
      await this.putState(updatedState);
      await this.emitRunnerEvent(updatedState, {
        eventType: 'session.attached',
        actorType: 'system',
        streamId: buildStreamId('session', sessionId),
        entityType: 'session',
        entityId: sessionId,
        payload: { runnerId: updatedState.runnerId, sessionId },
        correlationId: sessionId,
        causationId: updatedState.runnerId,
      });
      if (current.phase === 'provisioning' || current.phase === 'offline') {
        await this.emitRunnerEvent(updatedState, {
          eventType: 'runner.ready',
          actorType: 'runner',
          actorId: updatedState.runnerId,
          payload: { runnerId: updatedState.runnerId, phase: 'idle' },
          correlationId: sessionId,
          causationId: updatedState.runnerId,
        });
      }
      await this.emitRunnerEvent(updatedState, {
        eventType: 'runner.attached',
        actorType: 'runner',
        actorId: updatedState.runnerId,
        payload: { runnerId: updatedState.runnerId, sessionId },
        correlationId: sessionId,
        causationId: updatedState.runnerId,
      });
      return json({ ok: true, state: updatedState });
    }

    if (request.method === 'POST' && path === '/exec') {
      const body = (await parseJson(request)) as RunnerExecRequest;
      if (!body.sessionId || !body.command) {
        return json({ error: 'session_id_and_command_required', code: 'session_id_and_command_required' }, 400);
      }
      const containerBinding = await this.ensureContainerBinding();
      const busyState: RunnerState = {
        ...current,
        attachedSessionId: body.sessionId,
        phase: 'busy',
        updatedAt: nowIso(),
      };
      await this.putState(busyState);

      const correlationId = body.correlationId ?? body.sessionId;
      const causationId = body.causationId ?? body.sessionId;

      if (!busyState.containerId) {
        await this.emitRunnerEvent(busyState, {
          eventType: 'container.started',
          actorType: 'container',
          actorId: busyState.runnerId,
          streamId: buildStreamId('runner', busyState.runnerId),
          entityType: 'container',
          entityId: `${busyState.runnerId}-container`,
          payload: { runnerId: busyState.runnerId, sessionId: body.sessionId },
          correlationId,
          causationId,
          source: 'container',
        });
      } else {
        await this.emitRunnerEvent(busyState, {
          eventType: 'container.resumed',
          actorType: 'container',
          actorId: busyState.runnerId,
          streamId: buildStreamId('runner', busyState.runnerId),
          entityType: 'container',
          entityId: `${busyState.runnerId}-container`,
          payload: { runnerId: busyState.runnerId, sessionId: body.sessionId },
          correlationId,
          causationId,
          source: 'container',
        });
      }

      await this.emitRunnerEvent(busyState, {
        eventType: 'runner.exec.started',
        actorType: 'runner',
        actorId: busyState.runnerId,
        payload: {
          runnerId: busyState.runnerId,
          sessionId: body.sessionId,
          command: body.command,
          args: body.args ?? [],
          checkpoint: body.checkpoint ?? null,
        },
        correlationId,
        causationId,
      });

      const stub = containerBinding.getByName(busyState.runnerId);
      const response = await stub.fetch('http://container/exec', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          command: body.command,
          args: body.args ?? [],
          checkpoint: body.checkpoint ?? null,
        }),
      });
      const result = (await response.json().catch(() => null)) as RunnerExecResult | null;
      const success = response.ok && result && typeof result.exitCode === 'number' && result.exitCode === 0;

      const finalState: RunnerState = {
        ...busyState,
        containerId: busyState.containerId ?? `${busyState.runnerId}-container`,
        phase: success ? 'idle' : 'failed',
        lastExecResult: result,
        updatedAt: nowIso(),
      };
      await this.putState(finalState);

      await this.emitRunnerEvent(finalState, {
        eventType: success ? 'runner.exec.succeeded' : 'runner.exec.failed',
        actorType: 'runner',
        actorId: finalState.runnerId,
        payload: {
          runnerId: finalState.runnerId,
          sessionId: body.sessionId,
          command: body.command,
          args: body.args ?? [],
          exitCode: result?.exitCode ?? 1,
          stdout: result?.stdout ?? '',
          stderr: result?.stderr ?? (response.ok ? '' : 'container_exec_failed'),
        },
        correlationId,
        causationId,
      });
      await this.emitRunnerEvent(finalState, {
        eventType: 'container.sleeping',
        actorType: 'container',
        actorId: finalState.runnerId,
        streamId: buildStreamId('runner', finalState.runnerId),
        entityType: 'container',
        entityId: finalState.containerId ?? `${finalState.runnerId}-container`,
        payload: { runnerId: finalState.runnerId, sessionId: body.sessionId },
        correlationId,
        causationId,
        source: 'container',
      });

      return json({
        ok: success,
        state: finalState,
        result: result ?? { exitCode: 1, stdout: '', stderr: 'container_exec_failed' },
      }, success ? 200 : 500);
    }

    return json({ error: 'not_found', code: 'not_found' }, 404);
  }
}
