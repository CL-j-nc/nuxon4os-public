import fs from 'node:fs/promises';
import path from 'node:path';
import { explainActionAvailability } from '../../../packages/nuxon-core/src/runtime/action-policy.js';

const projectionFile = path.resolve('bridges/codex-runner/state/task_projection.json');
const eventsFile = path.resolve('bridges/codex-runner/state/events.ndjson');

async function readProjection() {
  try {
    return JSON.parse(await fs.readFile(projectionFile, 'utf8'));
  } catch {
    return {
      generated_at: null,
      latest_task_id: null,
      latest: null,
      task_list: [],
      tasks: {},
      counts: { total: 0, active: 0, awaiting_approval: 0, terminal: 0, failed: 0, quarantine: 0, by_status: {} },
    };
  }
}

async function readEvents() {
  const raw = await fs.readFile(eventsFile, 'utf8').catch(() => '');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function buildActionHistory(events: any[], taskId: string) {
  const interesting = ['APPROVAL_REQUIRED', 'APPROVAL_GRANTED', 'APPROVAL_REJECTED', 'RETRY_REQUESTED', 'RUN_CANCELLED', 'RUN_FAILED', 'RUN_SUCCEEDED'];
  return events
    .filter((event) => event.task_id === taskId && interesting.includes(event.type))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .map((event) => ({
      action:
        event.type === 'APPROVAL_REQUIRED'
          ? 'await_approval'
          : event.type === 'APPROVAL_GRANTED'
            ? 'approve'
            : event.type === 'APPROVAL_REJECTED'
              ? 'reject'
              : event.type === 'RUN_CANCELLED'
                ? 'cancel'
                : event.type === 'RETRY_REQUESTED'
                  ? 'retry'
                  : event.type === 'RUN_SUCCEEDED'
                    ? 'complete'
                    : 'fail',
      event_type: event.type,
      actor: event.payload?.actor ?? null,
      reason: event.payload?.reason ?? event.payload?.error ?? event.payload?.summary ?? null,
      requested_at: event.payload?.requested_at ?? null,
      occurred_at: event.timestamp,
      result_state:
        event.type === 'APPROVAL_REQUIRED'
          ? 'awaiting_approval'
          : event.type === 'APPROVAL_GRANTED'
            ? 'running'
            : event.type === 'APPROVAL_REJECTED'
              ? 'rejected'
              : event.type === 'RUN_CANCELLED'
                ? 'cancelled'
                : event.type === 'RETRY_REQUESTED'
                  ? 'queued'
                  : event.type === 'RUN_SUCCEEDED'
                    ? 'succeeded'
                    : event.payload?.failure_kind ?? 'failed',
      source:
        event.type === 'RUN_FAILED' && event.payload?.failure_kind === 'quarantine'
          ? 'system'
          : event.payload?.actor || event.payload?.requested_at
            ? 'surface_api'
            : ['RUN_SUCCEEDED', 'APPROVAL_REQUIRED', 'APPROVAL_GRANTED', 'APPROVAL_REJECTED', 'RUN_CANCELLED', 'RETRY_REQUESTED'].includes(event.type)
              ? 'runner'
              : 'unknown',
    }));
}

function buildActionAvailability(task: any) {
  return {
    approve: explainActionAvailability(task.status, 'approve', task),
    reject: explainActionAvailability(task.status, 'reject', task),
    cancel: explainActionAvailability(task.status, 'cancel', task),
    retry: explainActionAvailability(task.status, 'retry', task),
  };
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
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

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const projection = await readProjection();
  const events = await readEvents();

  if (request.method === 'GET' && url.pathname === '/v1/surface/tasks') {
    const status = url.searchParams.get('status');
    const limit = parseLimit(url.searchParams.get('limit'));
    const cursor = parseCursor(url.searchParams.get('cursor'));
    const filtered = (projection.task_list ?? []).filter((task: any) => !status || task.status === status);
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
      generated_at: projection.generated_at,
      latest_task_id: projection.latest_task_id,
      latest: projection.latest,
      counts: projection.counts ?? {},
      sort: 'bucket(active-first)-updated_at-desc-task_id-asc',
      items,
      tasks: items,
      next_cursor: nextCursor,
    });
  }

  const detailMatch = url.pathname.match(/^\/v1\/surface\/tasks\/([^/]+)$/);
  if (request.method === 'GET' && detailMatch) {
    const taskId = decodeURIComponent(detailMatch[1]);
    const task = projection.tasks?.[taskId] ?? null;
    if (!task) {
      return json(
        {
          error: 'task_not_found',
          code: 'task_not_found',
          task_id: taskId,
          latest_task_id: projection.latest_task_id ?? null,
        },
        404,
      );
    }

    return json({
      generated_at: projection.generated_at,
      latest_task_id: projection.latest_task_id,
      latest: projection.latest,
      task,
      available_actions: task.available_actions ?? [],
      action_history: buildActionHistory(events, taskId),
      action_availability: buildActionAvailability(task),
      actor: task.actor ?? null,
      requested_at: task.requested_at ?? null,
      retry_count: task.retry_count ?? 0,
      terminal_reason: task.terminal_reason ?? null,
      retryable: task.retryable ?? false,
      requires_human_action: task.requires_human_action ?? false,
    });
  }

  return json({ error: 'not_found' }, 404);
}

export default {
  fetch: handleRequest,
};
