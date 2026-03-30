import { explainActionAvailability } from '../../../packages/nuxon-core/src/runtime/action-policy.js';
import {
  buildActionHistory,
  buildTaskSurfaceFromDb,
  ensureNuxonRuntimeTables,
  listTaskEvents,
  normalizeEventRow,
} from '../../../packages/nuxon-runner-sdk/src/cloudflare-store.js';

type Env = {
  DB: D1Database;
};

const ALLOWED_ORIGINS = new Set([
  'https://nuxon4os.pages.dev',
  'https://nuxon-factory-dashboard.pages.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);

function makeCorsHeaders(origin: string | null) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://nuxon4os.pages.dev';
  return {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function json(payload: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json', ...makeCorsHeaders(origin) },
  });
}

function buildServiceIndex() {
  return {
    status: 'ok',
    service: 'conversation-surface',
    runtime: 'cloudflare',
    storage: 'd1',
    message: 'Nuxon conversation surface is live. Use the endpoints below instead of the bare worker URL.',
    endpoints: {
      health: '/health',
      tasks: 'GET /v1/surface/tasks',
      task_detail: 'GET /v1/surface/tasks/:taskId',
    },
  };
}

function parseLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 20;
  return Math.min(parsed, 100);
}

function parseCursor(value: string | null) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function buildActionAvailability(task: any) {
  return {
    approve: explainActionAvailability(task.status, 'approve', task),
    reject: explainActionAvailability(task.status, 'reject', task),
    cancel: explainActionAvailability(task.status, 'cancel', task),
    retry: explainActionAvailability(task.status, 'retry', task),
  };
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  await ensureNuxonRuntimeTables(env.DB);
  const url = new URL(request.url);
  const origin = request.headers.get('origin');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: makeCorsHeaders(origin) });
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ status: 'ok', service: 'conversation-surface', runtime: 'cloudflare', storage: 'd1' }, 200, origin);
  }

  if (request.method === 'GET' && url.pathname === '/') {
    return json(buildServiceIndex(), 200, origin);
  }

  const surface = await buildTaskSurfaceFromDb(env.DB);

  if (request.method === 'GET' && url.pathname === '/v1/surface/tasks') {
    const status = url.searchParams.get('status');
    const limit = parseLimit(url.searchParams.get('limit'));
    const cursor = parseCursor(url.searchParams.get('cursor'));
    const filtered = (surface.task_list ?? []).filter((task: any) => !status || task.status === status);
    const items = filtered.slice(cursor, cursor + limit).map((task: any) => ({
      ...task,
      last_actor: task.actor ?? null,
      last_requested_at: task.requested_at ?? null,
      available_actions: task.available_actions ?? [],
      retry_count: task.retry_count ?? 0,
      requires_human_action: task.requires_human_action ?? false,
    }));
    const nextCursor = cursor + limit < filtered.length ? String(cursor + limit) : null;
    return json({
      generated_at: surface.generated_at,
      latest_task_id: surface.latest_task_id,
      latest: surface.latest,
      counts: surface.counts ?? {},
      sort: surface.sort,
      items,
      tasks: items,
      next_cursor: nextCursor,
    }, 200, origin);
  }

  const detailMatch = url.pathname.match(/^\/v1\/surface\/tasks\/([^/]+)$/);
  if (request.method === 'GET' && detailMatch) {
    const taskId = decodeURIComponent(detailMatch[1]);
    const task = surface.tasks?.[taskId] ?? null;
    if (!task) {
      return json({ error: 'task_not_found', code: 'task_not_found', task_id: taskId, latest_task_id: surface.latest_task_id ?? null }, 404, origin);
    }
    const events = (await listTaskEvents(env.DB, taskId)).map(normalizeEventRow);
    return json({
      generated_at: surface.generated_at,
      latest_task_id: surface.latest_task_id,
      latest: surface.latest,
      task,
      available_actions: task.available_actions ?? [],
      action_history: buildActionHistory(events),
      action_availability: buildActionAvailability(task),
      actor: task.actor ?? null,
      requested_at: task.requested_at ?? null,
      retry_count: task.retry_count ?? 0,
      terminal_reason: task.terminal_reason ?? null,
      retryable: task.retryable ?? false,
      requires_human_action: task.requires_human_action ?? false,
    }, 200, origin);
  }

  return json({ error: 'not_found' }, 404, origin);
}

export default {
  fetch(request: Request, env: Env) {
    return handleRequest(request, env);
  },
};
