import type { SessionActorKind, SessionPhase, SessionState } from './session-types';

type Env = {
  RUNNER_SESSIONS?: DurableObjectNamespace;
};

function buildTenantHeaders(tenantId: string) {
  return {
    'content-type': 'application/json',
    'x-session-tenant-id': tenantId,
  };
}

async function parseJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (payload as Record<string, unknown> | null)?.error?.toString() ||
        (payload as Record<string, unknown> | null)?.code?.toString() ||
        `session_actor_http_${response.status}`,
    );
  }
  return payload;
}

function getSessionNamespace(env: Env) {
  if (!env.RUNNER_SESSIONS) {
    throw new Error('runner_sessions_binding_missing');
  }
  return env.RUNNER_SESSIONS;
}

export function getSessionStub(env: Env, sessionId: string) {
  const namespace = getSessionNamespace(env);
  return namespace.get(namespace.idFromName(sessionId));
}

export async function initSessionActor(
  env: Env,
  {
    sessionId,
    tenantId,
    runnerId,
    repo,
    branch,
    cwd,
    goal,
    summary,
    phase = 'idle',
  }: {
    sessionId: string;
    tenantId: string;
    runnerId: string;
    repo?: string | null;
    branch?: string | null;
    cwd?: string | null;
    goal?: string | null;
    summary?: string | null;
    phase?: SessionPhase;
  },
) {
  const stub = getSessionStub(env, sessionId);
  const response = await stub.fetch('https://runner-session/state/init', {
    method: 'POST',
    headers: buildTenantHeaders(tenantId),
    body: JSON.stringify({
      sessionId,
      tenantId,
      runnerId,
      repo: repo ?? null,
      branch: branch ?? null,
      cwd: cwd ?? null,
      goal: goal ?? null,
      summary: summary ?? null,
      phase,
    }),
  });
  return parseJson(response);
}

export async function appendSessionActorEvent(
  env: Env,
  {
    sessionId,
    tenantId,
    type,
    actor,
    payload = {},
  }: {
    sessionId: string;
    tenantId: string;
    type: string;
    actor: SessionActorKind;
    payload?: Record<string, unknown>;
  },
) {
  const stub = getSessionStub(env, sessionId);
  const response = await stub.fetch('https://runner-session/events/append', {
    method: 'POST',
    headers: buildTenantHeaders(tenantId),
    body: JSON.stringify({ type, actor, payload }),
  });
  return parseJson(response);
}

export async function upsertSessionActorSlot(
  env: Env,
  {
    sessionId,
    tenantId,
    key,
    value,
    confidence,
    sourceEventId,
  }: {
    sessionId: string;
    tenantId: string;
    key: string;
    value: unknown;
    confidence?: number | null;
    sourceEventId?: string | null;
  },
) {
  const stub = getSessionStub(env, sessionId);
  const response = await stub.fetch('https://runner-session/slots/upsert', {
    method: 'POST',
    headers: buildTenantHeaders(tenantId),
    body: JSON.stringify({ key, value, confidence: confidence ?? null, sourceEventId: sourceEventId ?? null }),
  });
  return parseJson(response);
}

export async function saveSessionActorCheckpoint(env: Env, { sessionId, tenantId }: { sessionId: string; tenantId: string }) {
  const stub = getSessionStub(env, sessionId);
  const response = await stub.fetch('https://runner-session/checkpoint/save', {
    method: 'POST',
    headers: buildTenantHeaders(tenantId),
  });
  return parseJson(response);
}

export async function getSessionActorState(env: Env, { sessionId, tenantId }: { sessionId: string; tenantId: string }) {
  const stub = getSessionStub(env, sessionId);
  const response = await stub.fetch(`https://runner-session/state`, {
    method: 'GET',
    headers: buildTenantHeaders(tenantId),
  });
  return parseJson(response) as Promise<{ ok: true; state: SessionState; slots: unknown[] }>;
}

export async function mergeSessionActorState(
  env: Env,
  {
    sessionId,
    tenantId,
    patch,
  }: {
    sessionId: string;
    tenantId: string;
    patch: Record<string, unknown>;
  },
) {
  const stub = getSessionStub(env, sessionId);
  const response = await stub.fetch(`https://runner-session/state/merge`, {
    method: 'POST',
    headers: buildTenantHeaders(tenantId),
    body: JSON.stringify({ patch }),
  });
  return parseJson(response);
}

export async function listSessionActorEvents(
  env: Env,
  {
    sessionId,
    tenantId,
    limit,
  }: {
    sessionId: string;
    tenantId: string;
    limit?: number;
  },
) {
  const stub = getSessionStub(env, sessionId);
  const suffix = typeof limit === 'number' ? `?limit=${encodeURIComponent(String(limit))}` : '';
  const response = await stub.fetch(`https://runner-session/events${suffix}`, {
    method: 'GET',
    headers: buildTenantHeaders(tenantId),
  });
  return parseJson(response);
}

export async function getSessionActorCheckpoint(env: Env, { sessionId, tenantId }: { sessionId: string; tenantId: string }) {
  const stub = getSessionStub(env, sessionId);
  const response = await stub.fetch('https://runner-session/checkpoint', {
    method: 'GET',
    headers: buildTenantHeaders(tenantId),
  });
  return parseJson(response);
}
