import fs from 'node:fs/promises';
import path from 'node:path';

import { compileIntent } from '../../../packages/nuxon-core/src/compiler/intent-compiler.js';
import { planHandshake } from '../../../packages/nuxon-core/src/handshake/planner.js';
import { explainActionAvailability } from '../../../packages/nuxon-core/src/runtime/action-policy.js';

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
}

const projectionFile = path.resolve('bridges/codex-runner/state/task_projection.json');
const inboxDir = path.resolve('bridges/codex-runner/tasks/inbox');
const workingDir = path.resolve('bridges/codex-runner/tasks/working');
const failedDir = path.resolve('bridges/codex-runner/tasks/failed');
const doneDir = path.resolve('bridges/codex-runner/tasks/done');
const approvalsDir = path.resolve('bridges/codex-runner/tasks/approvals');

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mapToolToTarget(tool: string) {
  switch (tool) {
    case 'terminal_codex':
      return 'codex_terminal';
    case 'github':
      return 'github_actions';
    case 'cloudflare':
      return 'cloudflare_deploy';
    default:
      return 'generic_task';
  }
}

function mapRuntime(runtime: string) {
  switch (runtime) {
    case 'ci':
      return 'ci_cd';
    case 'cloud':
    case 'local_server':
      return 'remote_server';
    case 'browser':
    case 'desktop':
    case 'mobile':
    default:
      return 'local_machine';
  }
}

function buildHandshakeResponse(body: Record<string, unknown>) {
  const tool = String(body.tool ?? 'custom_tool');
  const runtime = String(body.runtime ?? 'desktop');
  const interactionMode = String(body.interaction_mode ?? 'watch');
  const permissions = Array.isArray(body.permissions)
    ? body.permissions.map((item) => String(item))
    : [];
  const intent = {
    raw_input: `Connect ${tool} with ${interactionMode} on ${runtime}`,
    target: mapToolToTarget(tool),
    runtime: mapRuntime(runtime),
    interaction_mode: interactionMode === 'interactive' ? 'two_way_control' : 'observe_only',
    capabilities: [
      mapToolToTarget(tool),
      mapRuntime(runtime),
      ...(interactionMode === 'interactive' ? ['two_way_control'] : []),
      ...(interactionMode === 'poll' ? ['status_sync'] : []),
      ...permissions,
    ],
    approval_policy: {
      approval_before_mutation: permissions.includes('modify_configuration') || permissions.includes('automatic_execution'),
    },
    install_method: mapToolToTarget(tool) === 'codex_terminal' ? 'file_bundle' : 'connector_push',
  };
  const handshake = planHandshake(intent as any);

  return {
    selected_tool: tool,
    interaction_mode: interactionMode,
    runtime,
    permissions,
    install_method: handshake.install_method,
    snippet: [
      '# Nuxon Handshake',
      `NUXON_TOOL=${tool}`,
      `NUXON_MODE=${interactionMode}`,
      `NUXON_RUNTIME=${runtime}`,
      `NUXON_PERMISSIONS=${permissions.join(',') || 'view_status'}`,
    ].join('\n'),
    bundle_download_url: `/v1/handshake/download?tool=${encodeURIComponent(tool)}`,
    setup_url: 'https://nuxon4os.pages.dev/connectors',
    verify_url: '/v1/surface/tasks?status=awaiting_approval',
    verify_state: {
      status: 'waiting_for_connection',
      steps: [
        { id: 'generated', label: 'Handshake generated', state: 'complete' },
        { id: 'received', label: 'Waiting for tool to receive the package', state: 'pending' },
        { id: 'verified', label: 'Waiting for permission verification', state: 'pending' },
        { id: 'connected', label: 'Connection success', state: 'pending' },
      ],
    },
    handshake,
  };
}

async function readProjection(taskId?: string) {
  try {
    const raw = await fs.readFile(projectionFile, 'utf8');
    const payload = JSON.parse(raw);
    if (!taskId) {
      return payload;
    }
    if (!payload.tasks?.[taskId]) {
      return {
        error: 'task_not_found',
        task_id: taskId,
        latest_task_id: payload.latest_task_id ?? null,
      };
    }
    return {
      latest_task_id: payload.latest_task_id,
      latest: payload.latest,
      task: payload.tasks?.[taskId] ?? null,
      task_list: payload.task_list ?? [],
      counts: payload.counts ?? {},
    };
  } catch {
    return taskId
      ? { error: 'task_not_found', task_id: taskId, latest_task_id: null }
      : { latest_task_id: null, latest: null, task_list: [], tasks: {}, counts: {} };
  }
}

function buildTaskFromInput(input: string) {
  const intent = compileIntent(input);
  const handshake = planHandshake(intent);
  const now = new Date().toISOString();
  const taskId = makeId('task');
  const connectionId = makeId('connection');

  return {
    intent,
    handshake,
    task: {
      id: taskId,
      input,
      status: 'compiled',
      target: intent.target,
      runtime: intent.runtime,
      phase: 'intent_compiled',
      summary: `Compiled task for ${intent.target}`,
      policy: {
        approval_before_mutation: intent.approval_policy.approval_before_mutation,
        install_method: intent.install_method,
        interaction_mode: intent.interaction_mode,
        status_sync: intent.capabilities.includes('status_sync'),
      },
      capabilities: intent.capabilities,
      blocker: null,
      artifacts: {},
      created_at: now,
      updated_at: now,
    },
    connection: {
      id: connectionId,
      target: intent.target,
      runtime: intent.runtime,
      transport: handshake.transport,
      status: 'planned',
      install_method: handshake.install_method,
      files: handshake.files,
      env: handshake.env,
      verify_steps: handshake.verify_steps,
      created_at: now,
      updated_at: now,
    },
  };
}

async function findTaskFile(taskId: string) {
  const candidates = [
    { state: 'queued', dir: inboxDir },
    { state: 'working', dir: workingDir },
    { state: 'failed', dir: failedDir },
    { state: 'done', dir: doneDir },
  ];

  for (const candidate of candidates) {
    const filePath = path.join(candidate.dir, `${taskId}.json`);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return {
        filePath,
        location: candidate.state,
        task: JSON.parse(raw),
      };
    } catch {
      continue;
    }
  }

  return null;
}

function getActionPreview(action: string) {
  switch (action) {
    case 'approve':
      return 'running';
    case 'reject':
      return 'rejected';
    case 'cancel':
      return 'cancelled';
    case 'retry':
      return 'queued';
    default:
      return 'unknown';
  }
}

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/v1/tasks/projection') {
    const taskId = url.searchParams.get('task_id') ?? undefined;
    const payload = await readProjection(taskId);
    const status = taskId && payload?.error === 'task_not_found' ? 404 : 200;
    return json(payload, status);
  }

  if (request.method === 'POST' && url.pathname === '/v1/handshake/generate') {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return json(buildHandshakeResponse(body));
  }

  if (request.method === 'POST' && url.pathname === '/v1/tasks/dispatch') {
    const body = (await request.json()) as { input?: string; task?: Record<string, unknown> };
    let compiled;

    if (typeof body.input === 'string' && body.input.trim()) {
      compiled = buildTaskFromInput(body.input.trim());
    } else if (body.task && typeof body.task === 'object') {
      const task = body.task as Record<string, unknown>;
      const input = String(task.input ?? task.summary ?? '').trim();
      if (!input) {
        return json({ error: 'input_required' }, 400);
      }
      compiled = buildTaskFromInput(input);
      compiled.task = {
        ...compiled.task,
        ...task,
        id: String(task.id ?? compiled.task.id),
        updated_at: new Date().toISOString(),
      };
    } else {
      return json({ error: 'input_required' }, 400);
    }

    await fs.mkdir(inboxDir, { recursive: true });
    const inboxPath = path.join(inboxDir, `${compiled.task.id}.json`);
    const queuedTask = {
      ...compiled.task,
      approval_before_mutation: compiled.task.policy.approval_before_mutation,
      status: 'queued',
      phase: 'queued',
      dispatched_at: new Date().toISOString(),
    };
    await fs.writeFile(inboxPath, `${JSON.stringify(queuedTask, null, 2)}\n`);

    return json({
      task: queuedTask,
      connection: compiled.connection,
      handshake: compiled.handshake,
      dispatch_result: {
        queued: true,
        inbox_path: path.relative(path.resolve('.'), inboxPath),
      },
          projection: {
            task_id: queuedTask.id,
            status: 'queued',
            phase: 'queued',
            summary: queuedTask.summary,
            blocker: null,
            actions_available: ['run'],
            next_actions: ['run'],
            available_actions: [{ id: 'run', label: 'Run task', kind: 'observe', target: 'runner' }],
            terminal_reason: null,
            retryable: false,
            requires_human_action: false,
            actor: null,
            requested_at: null,
            retry_count: 0,
            updated_at: queuedTask.updated_at,
          },
      next_actions: ['observe_projection', 'run_runner'],
      surface: await readProjection(),
    });
  }

  const actionMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/actions\/(approve|reject|cancel|retry)$/);
  if (request.method === 'POST' && actionMatch) {
    const taskId = decodeURIComponent(actionMatch[1]);
    const action = actionMatch[2];
    const taskRecord = await findTaskFile(taskId);
    if (!taskRecord) {
      return json(
        {
          ok: false,
          error: 'task_not_found',
          code: 'task_not_found',
          task_id: taskId,
          action,
        },
        404,
      );
    }

    const effectiveStatus = taskRecord.task.status ?? (taskRecord.location === 'working' ? 'running' : taskRecord.location);
    const whyNotAllowed = explainActionAvailability(effectiveStatus, action, taskRecord.task);
    if (!whyNotAllowed.allowed) {
      return json(
        {
          ok: false,
          error: 'action_not_allowed',
          code: 'action_not_allowed',
          task_id: taskId,
          action,
          why_not_allowed: whyNotAllowed,
        },
        409,
      );
    }

    await fs.mkdir(approvalsDir, { recursive: true });
    const actionFile = path.join(approvalsDir, `${taskId}.json`);
    const body = await request.json().catch(() => ({}));
    await fs.writeFile(
      actionFile,
      `${JSON.stringify(
        {
          action,
          reason: body?.reason ?? `${action} requested via task-orchestrator`,
          patch: body?.patch,
          actor: body?.actor ?? 'surface_api',
          requested_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );

    return json({
      ok: true,
      task_id: taskId,
      action,
      enqueued: true,
      applied: false,
      next_state: getActionPreview(action),
      projection: (await readProjection(taskId)).task ?? null,
    });
  }

  if (request.method !== 'POST' || url.pathname !== '/v1/tasks/compile') {
    return json({ error: 'not_found' }, 404);
  }

  const body = (await request.json()) as { input?: string };
  const input = String(body.input ?? '').trim();
  if (!input) {
    return json({ error: 'input_required' }, 400);
  }

  const { task, connection, handshake } = buildTaskFromInput(input);
  const response = {
    task,
    connection,
    handshake,
    next_actions: ['dispatch_task', 'view_projection'],
    surface: await readProjection(),
  };

  return json(response);
}

export default {
  fetch: handleRequest,
};
