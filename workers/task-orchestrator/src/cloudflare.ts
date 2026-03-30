import { compileIntent } from '../../../packages/nuxon-core/src/compiler/intent-compiler.js';
import { planHandshake } from '../../../packages/nuxon-core/src/handshake/planner.js';
import { explainActionAvailability } from '../../../packages/nuxon-core/src/runtime/action-policy.js';
import {
  appendTaskEvent,
  appendConversationMessage,
  buildTaskSurfaceFromDb,
  createConversation,
  ensureNuxonRuntimeTables,
  findRunnerSession,
  getConversation,
  getRunnerSession,
  getTaskRecord,
  listRunnerSessions,
  listConversationMessages,
  makeId,
  saveTaskRecord,
  upsertRunnerSession,
  updateRunnerSessionMetadata,
  updateRunnerSessionScope,
  updateTaskSnapshot,
} from '../../../packages/nuxon-runner-sdk/src/cloudflare-store.js';
import { RunnerSessionDO } from './RunnerSessionDO';
import { CloudRunnerDO } from './CloudRunnerDO';
import { CodexRunnerContainer } from './CodexRunnerContainer';
import { bridgeLegacyEvent } from './event-bridge';
import { projectSessionRunnerBinding, summarizeUnifiedProjections } from './event-projections';
import { buildStreamId } from './event-types';
import {
  appendSessionActorEvent,
  getSessionActorCheckpoint,
  getSessionActorState,
  initSessionActor,
  listSessionActorEvents,
  mergeSessionActorState,
  saveSessionActorCheckpoint,
  upsertSessionActorSlot,
} from './session-runtime';
import { listUnifiedEventsByStream } from './unified-event-store';
import type { RunnerExecRequest } from './runner-types';

type Env = {
  DB: D1Database;
  RUNNER_SESSIONS?: DurableObjectNamespace;
  CLOUD_RUNNERS?: DurableObjectNamespace;
  CODEX_RUNNER_CONTAINER?: {
    getByName: (name: string) => {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    };
  };
};

type HandshakeRequest = {
  tool?: string;
  interaction_mode?: string;
  runtime?: string;
  permissions?: string[];
};

type ConversationOpenRequest = {
  tool?: string;
  interaction_mode?: string;
  runtime?: string;
  permissions?: string[];
  title?: string;
};

type RunnerConnectRequest = {
  runner_id?: string;
  tool?: string;
  runtime?: string;
  interaction_mode?: string;
  install_method?: string;
  permissions?: string[];
  status?: string;
  metadata?: Record<string, unknown>;
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
    'access-control-allow-headers': 'content-type,authorization,x-nuxon-tenant-id',
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
    service: 'task-orchestrator',
    runtime: 'cloudflare',
    storage: 'd1',
    message: 'Nuxon task orchestrator is live. Use the endpoints below instead of the bare worker URL.',
    endpoints: {
      health: '/health',
      handshake_generate: 'POST /v1/handshake/generate',
      task_compile: 'POST /v1/tasks/compile',
      task_dispatch: 'POST /v1/tasks/dispatch',
      task_projection: 'GET /v1/tasks/projection',
      conversation_open: 'POST /v1/conversations/open',
      conversation_detail: 'GET /v1/conversations/:conversationId',
      runner_status: 'GET /v1/runners/status',
    },
  };
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function resolveTenantScope(request: Request) {
  const hintedTenant = request.headers.get('x-nuxon-tenant-id')?.trim();
  if (hintedTenant) {
    return `tenant:${slugify(hintedTenant)}`;
  }

  const auth = request.headers.get('authorization')?.trim() ?? '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (token) {
      const hash = await sha256Hex(token);
      return `auth:${hash.slice(0, 24)}`;
    }
  }

  return null;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function isoFromUnix(value: number | null | undefined) {
  if (typeof value === 'number') {
    return new Date(value * 1000).toISOString();
  }
  return null;
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

function mapInteractionMode(mode: string) {
  return mode === 'interactive' ? 'two_way_control' : 'observe_only';
}

function buildHandshakeIntent(request: HandshakeRequest) {
  const tool = request.tool || 'custom_tool';
  const runtime = request.runtime || 'desktop';
  const interactionMode = request.interaction_mode || 'watch';
  const permissions = Array.isArray(request.permissions) ? request.permissions : [];
  const readablePermissions = permissions.length ? permissions.join(', ') : 'view_status';
  const target = mapToolToTarget(tool);

  return {
    raw_input: `Connect ${tool} with ${interactionMode} on ${runtime}`,
    target,
    runtime: mapRuntime(runtime),
    interaction_mode: mapInteractionMode(interactionMode),
    capabilities: [
      target,
      mapRuntime(runtime),
      ...(interactionMode === 'interactive' ? ['two_way_control'] : []),
      ...(interactionMode === 'poll' ? ['status_sync'] : []),
      ...permissions,
    ],
    approval_policy: {
      approval_before_mutation: permissions.includes('modify_configuration') || permissions.includes('automatic_execution'),
    },
    install_method: target === 'codex_terminal' ? 'file_bundle' : 'connector_push',
    meta: {
      tool,
      interaction_mode: interactionMode,
      runtime,
      permissions: readablePermissions,
    },
  };
}

function buildHandshakeResponse(request: HandshakeRequest) {
  const intent = buildHandshakeIntent(request);
  const handshake = planHandshake(intent as any);
  const tool = request.tool || 'custom_tool';
  const interactionMode = request.interaction_mode || 'watch';
  const runtime = request.runtime || 'desktop';
  const permissions = Array.isArray(request.permissions) ? request.permissions : [];
  const setupUrlMap: Record<string, string> = {
    github: 'https://github.com/settings/installations',
    cloudflare: 'https://dash.cloudflare.com/',
    vercel: 'https://vercel.com/dashboard',
    terminal_codex: 'https://nuxon4os.pages.dev/nuxon',
  };
  const snippet = [
    '# Nuxon Handshake',
    `NUXON_TOOL=${tool}`,
    `NUXON_MODE=${interactionMode}`,
    `NUXON_RUNTIME=${runtime}`,
    `NUXON_PERMISSIONS=${permissions.join(',') || 'view_status'}`,
    `NUXON_INSTALL_METHOD=${handshake.install_method}`,
  ].join('\n');

  return {
    selected_tool: tool,
    interaction_mode: interactionMode,
    runtime,
    permissions,
    install_method: handshake.install_method,
    snippet,
    bundle_download_url: `/v1/handshake/download?tool=${encodeURIComponent(tool)}&interaction_mode=${encodeURIComponent(interactionMode)}&runtime=${encodeURIComponent(runtime)}&permissions=${encodeURIComponent(permissions.join(','))}`,
    setup_url: setupUrlMap[tool] || 'https://nuxon4os.pages.dev/connectors',
    verify_url: `/v1/runners/status?tool=${encodeURIComponent(tool)}&runtime=${encodeURIComponent(runtime)}`,
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

function buildRunnerVerifyState(session: any) {
  const connected = Boolean(session);
  const verified = connected && String(session.status ?? '').includes('verified');
  const successful = connected && String(session.status ?? '').includes('connected');
  return {
    runner_id: session?.runner_id ?? null,
    status: session?.status ?? 'waiting_for_connection',
    connected_at: session?.connected_at_iso ?? null,
    last_heartbeat_at: session?.last_heartbeat_at_iso ?? null,
    tool: session?.tool ?? null,
    runtime: session?.runtime ?? null,
    interaction_mode: session?.interaction_mode ?? null,
    install_method: session?.install_method ?? null,
    permissions: session?.permissions ?? [],
    metadata: session?.metadata ?? {},
    steps: [
      { id: 'generated', label: 'Handshake generated', state: 'complete' },
      { id: 'received', label: 'Handshake received', state: connected ? 'complete' : 'pending' },
      { id: 'verified', label: 'Permissions verified', state: verified || successful ? 'complete' : 'pending' },
      { id: 'connected', label: 'Connection success', state: successful ? 'complete' : 'pending' },
    ],
  };
}

function buildTentacleDisplayName(session: any) {
  const stored = String(session?.metadata?.display_name ?? '').trim();
  if (stored) return stored;
  if (session?.tool === 'terminal_codex') return '本地终端 Codex';
  if (session?.tool === 'github') return 'GitHub 触手';
  if (session?.tool === 'cloudflare') return 'Cloudflare 触手';
  return `${String(session?.tool ?? 'custom_tool').replace(/[_-]+/g, ' ')} 触手`;
}

async function buildTentacleAsset(env: Env, session: any) {
  const linkedConversationId = session?.metadata?.linked_conversation_id ?? null;
  const linkedConversation = linkedConversationId ? await buildConversationPayload(env, linkedConversationId) : null;
  const latestTask = linkedConversation?.latest_task ?? null;
  const availableActions = ['continue', 'verify', 'reconnect'];
  if (latestTask) availableActions.push('view_tasks');
  return {
    tentacle_id: session.runner_id,
    connection_id: session.runner_id,
    display_name: buildTentacleDisplayName(session),
    tool: session.tool,
    runtime: session.runtime,
    interaction_mode: session.interaction_mode,
    status: session.status,
    verified: session.status === 'connected' || session.status === 'verified',
    connected: session.status === 'connected',
    last_seen: session.last_heartbeat_at_iso ?? session.updated_at_iso ?? null,
    conversation_id: linkedConversationId,
    available_actions: availableActions,
    latest_task:
      latestTask
        ? {
            task_id: latestTask.task_id,
            status: latestTask.status,
            phase: latestTask.phase,
            summary: latestTask.summary,
          }
        : null,
  };
}

async function maybeLinkRunnerConversation(env: Env, tenantId: string, conversationId: string, tool: string, runtime: string) {
  const session = await findRunnerSession(env.DB, { tool, runtime, tenantId, maxAgeSeconds: 86400 });
  if (!session) return null;
  return updateRunnerSessionScope(env.DB, session.runner_id, {
    tenantId,
    metadataPatch: {
      linked_conversation_id: conversationId,
      display_name: buildTentacleDisplayName(session),
    },
  });
}

async function ensureConversationSessionActor(
  env: Env,
  {
    tenantId,
    conversationId,
    runnerId,
    conversation,
    latestTask,
    sessionPhase = 'attached',
  }: {
    tenantId: string;
    conversationId: string;
    runnerId: string;
    conversation: any;
    latestTask?: any;
    sessionPhase?: any;
  },
) {
  if (!env.RUNNER_SESSIONS) return null;
  await initSessionActor(env, {
    sessionId: conversationId,
    tenantId,
    runnerId,
    goal: latestTask?.summary ?? conversation.title ?? buildConversationTitle(conversation.tool),
    summary: latestTask?.summary ?? conversation.title ?? null,
    phase: sessionPhase,
  });
  await upsertSessionActorSlot(env, {
    sessionId: conversationId,
    tenantId,
    key: 'runner_mode',
    value: 'local',
  });
  await upsertSessionActorSlot(env, {
    sessionId: conversationId,
    tenantId,
    key: 'approval_required',
    value: Boolean(latestTask?.requires_human_action),
  });
  await upsertSessionActorSlot(env, {
    sessionId: conversationId,
    tenantId,
    key: 'resume_strategy',
    value: 'session_checkpoint',
  });
  await upsertSessionActorSlot(env, {
    sessionId: conversationId,
    tenantId,
    key: 'needs_persistence',
    value: true,
  });
  return getSessionActorState(env, { sessionId: conversationId, tenantId });
}

async function appendConversationSessionLifecycle(
  env: Env,
  {
    tenantId,
    conversationId,
    runnerId,
    conversation,
  }: {
    tenantId: string;
    conversationId: string;
    runnerId: string;
    conversation: any;
  },
) {
  if (!env.RUNNER_SESSIONS) return;
  await appendSessionActorEvent(env, {
    sessionId: conversationId,
    tenantId,
    type: 'session.resumed',
    actor: 'system',
    payload: {
      summary: conversation.title ?? buildConversationTitle(conversation.tool),
      runtime: conversation.runtime,
    },
  });
  await appendSessionActorEvent(env, {
    sessionId: conversationId,
    tenantId,
    type: 'conversation.attached',
    actor: 'system',
    payload: {
      conversationId,
      summary: conversation.title ?? buildConversationTitle(conversation.tool),
    },
  });
  await appendSessionActorEvent(env, {
    sessionId: conversationId,
    tenantId,
    type: 'runner.attached',
    actor: 'runner',
    payload: {
      runnerId,
      runtime: conversation.runtime,
      tool: conversation.tool,
      summary: `Runner ${runnerId} attached`,
    },
  });
}

async function recoverConversationSessionActor(
  env: Env,
  {
    tenantId,
    conversationId,
    runnerId,
    conversation,
    latestTask,
    sessionPhase = 'attached',
  }: {
    tenantId: string;
    conversationId: string;
    runnerId: string;
    conversation: any;
    latestTask?: any;
    sessionPhase?: any;
  },
) {
  await ensureConversationSessionActor(env, {
    tenantId,
    conversationId,
    runnerId,
    conversation,
    latestTask,
    sessionPhase,
  });
  await appendConversationSessionLifecycle(env, {
    tenantId,
    conversationId,
    runnerId,
    conversation,
  });
  await saveSessionActorCheckpoint(env, {
    sessionId: conversationId,
    tenantId,
  });
}

function buildConversationTitle(tool: string) {
  const readable = tool.replace(/[_-]+/g, ' ').trim();
  return readable ? `Tentacles · ${readable}` : 'Tentacles';
}

function buildConversationWelcome(tool: string, runtime: string, interactionMode: string) {
  return `Tentacles is ready to work with ${tool} on ${runtime} using ${interactionMode}. Send a request to begin the interaction.`;
}

function buildAssistantSummary(task: any, tool: string) {
  switch (task.status) {
    case 'awaiting_approval':
      return `I prepared the next step for ${tool}. Approval is required before I continue.`;
    case 'succeeded':
      return `I sent that request to ${tool}. The control surface accepted it successfully.`;
    case 'retryable_failed':
      return `The request to ${tool} failed, but it can be retried from Nuxon.`;
    case 'failed':
      return `The request to ${tool} failed and needs manual review before retrying.`;
    case 'quarantine':
      return `The request could not be processed because the task payload was malformed.`;
    case 'cancelled':
      return `The request to ${tool} was cancelled.`;
    case 'rejected':
      return `The request to ${tool} was rejected.`;
    default:
      return `I recorded your request for ${tool}.`;
  }
}

async function buildConversationPayload(env: Env, conversationId: string) {
  const conversation = await getConversation(env.DB, conversationId);
  if (!conversation) return null;
  const surface = await buildTaskSurfaceFromDb(env.DB);
  const messages = (await listConversationMessages(env.DB, conversationId)).map((message) => ({
    id: message.id,
    conversation_id: message.conversation_id,
    role: message.role,
    content: message.content_text,
    source: message.source ?? 'unknown',
    task_id: message.task_id ?? null,
    created_at: message.created_at_iso ?? isoFromUnix(message.created_at),
    metadata: message.metadata ?? {},
    task: message.task_id ? surface.tasks?.[message.task_id] ?? null : null,
  }));
  const latestTask = [...messages].reverse().find((message) => message.task)?.task ?? null;
  return {
    conversation: {
      id: conversation.conversation_id,
      title: conversation.title,
      tool: conversation.tool,
      interaction_mode: conversation.interaction_mode,
      runtime: conversation.runtime,
      permissions: conversation.permissions ?? [],
      status: conversation.status,
      created_at: conversation.created_at_iso,
      updated_at: conversation.updated_at_iso,
    },
    messages,
    latest_task: latestTask,
    surface: {
      latest_task_id: surface.latest_task_id,
      latest: surface.latest,
      counts: surface.counts ?? {},
    },
  };
}

function conversationMatchesTenant(conversation: any, tenantId: string | null) {
  if (!conversation) return false;
  if (!tenantId) return false;
  return String(conversation.tenant_id ?? 'default') === tenantId;
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

async function readProjection(env: Env, taskId?: string) {
  const surface = await buildTaskSurfaceFromDb(env.DB);
  if (!taskId) return surface;
  if (!surface.tasks?.[taskId]) {
    return {
      error: 'task_not_found',
      task_id: taskId,
      latest_task_id: surface.latest_task_id ?? null,
    };
  }
  return {
    latest_task_id: surface.latest_task_id,
    latest: surface.latest,
    task: surface.tasks[taskId],
    task_list: surface.task_list ?? [],
    counts: surface.counts ?? {},
  };
}

function getCloudRunnerStub(env: Env, runnerId: string) {
  if (!env.CLOUD_RUNNERS) {
    throw new Error('cloud_runners_binding_missing');
  }
  return env.CLOUD_RUNNERS.get(env.CLOUD_RUNNERS.idFromName(runnerId));
}

async function parseRunnerJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (payload as Record<string, unknown> | null)?.error?.toString() ||
        (payload as Record<string, unknown> | null)?.code?.toString() ||
        `cloud_runner_http_${response.status}`,
    );
  }
  return payload;
}

async function initCloudRunner(env: Env, { runnerId, tenantId }: { runnerId: string; tenantId: string }) {
  const stub = getCloudRunnerStub(env, runnerId);
  const response = await stub.fetch('https://cloud-runner/init', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-runner-tenant-id': tenantId,
    },
    body: JSON.stringify({ runnerId, tenantId }),
  });
  return parseRunnerJson(response);
}

async function getCloudRunnerState(env: Env, { runnerId, tenantId }: { runnerId: string; tenantId: string }) {
  const stub = getCloudRunnerStub(env, runnerId);
  const response = await stub.fetch('https://cloud-runner/state', {
    method: 'GET',
    headers: {
      'x-runner-tenant-id': tenantId,
    },
  });
  return parseRunnerJson(response);
}

async function attachSessionToCloudRunner(
  env: Env,
  {
    runnerId,
    tenantId,
    sessionId,
  }: {
    runnerId: string;
    tenantId: string;
    sessionId: string;
  },
) {
  const stub = getCloudRunnerStub(env, runnerId);
  const response = await stub.fetch('https://cloud-runner/attach-session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-runner-tenant-id': tenantId,
    },
    body: JSON.stringify({ runnerId, tenantId, sessionId }),
  });
  return parseRunnerJson(response);
}

async function execCloudRunner(
  env: Env,
  {
    runnerId,
    tenantId,
    request,
  }: {
    runnerId: string;
    tenantId: string;
    request: RunnerExecRequest;
  },
) {
  const stub = getCloudRunnerStub(env, runnerId);
  const response = await stub.fetch('https://cloud-runner/exec', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-runner-tenant-id': tenantId,
    },
    body: JSON.stringify(request),
  });
  const payload = await response.json().catch(() => null);
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

async function runCloudControlPlaneDispatch(env: Env, task: any) {
  const approvalRequired = task.approval_before_mutation === true || task.policy?.approval_before_mutation === true;
  await appendTaskEvent(env.DB, {
    taskId: task.id,
    eventType: 'TASK_DISPATCHED',
    source: 'runner',
    payload: {
      task_id: task.id,
      summary: task.summary ?? `Task ${task.id} dispatched`,
    },
  });
  await bridgeLegacyEvent(env.DB, {
    tenantId: String(task.tenant_id ?? 'default'),
    legacyType: 'TASK_DISPATCHED',
    taskId: task.id,
    actorType: 'runner',
    payload: {
      task_id: task.id,
      summary: task.summary ?? `Task ${task.id} dispatched`,
    },
    correlationId: task.id,
    causationId: task.id,
  });

  if (approvalRequired) {
    await appendTaskEvent(env.DB, {
      taskId: task.id,
      eventType: 'STATUS_REPORTED',
      source: 'runner',
      payload: {
        task_id: task.id,
        status: 'awaiting_approval',
        phase: 'awaiting_approval',
        summary: task.summary ?? 'Task requires approval before mutation',
      },
    });
    await appendTaskEvent(env.DB, {
      taskId: task.id,
      eventType: 'APPROVAL_REQUIRED',
      source: 'runner',
      payload: {
        task_id: task.id,
        reason: task.reason ?? 'Task requires approval before mutation',
      },
    });
    await bridgeLegacyEvent(env.DB, {
      tenantId: String(task.tenant_id ?? 'default'),
      legacyType: 'APPROVAL_REQUIRED',
      taskId: task.id,
      actorType: 'runner',
      payload: {
        task_id: task.id,
        reason: task.reason ?? 'Task requires approval before mutation',
        summary: task.summary ?? 'Task requires approval before mutation',
      },
      correlationId: task.id,
      causationId: task.id,
    });
    return;
  }

  if (task.force_fail === true) {
    await appendTaskEvent(env.DB, {
      taskId: task.id,
      eventType: 'STATUS_REPORTED',
      source: 'runner',
      payload: {
        task_id: task.id,
        status: 'running',
        phase: 'dispatched',
        summary: task.summary ?? `Task ${task.id} dispatched`,
      },
    });
    await appendTaskEvent(env.DB, {
      taskId: task.id,
      eventType: 'RUN_FAILED',
      source: 'runner',
      payload: {
        task_id: task.id,
        error: task.fail_reason ?? 'Forced failure for cloud control plane',
        retryable: task.retryable !== false,
        failure_kind: task.retryable === false ? 'failed' : 'retryable_failed',
        terminal_reason: 'execution_failed',
      },
    });
    await bridgeLegacyEvent(env.DB, {
      tenantId: String(task.tenant_id ?? 'default'),
      legacyType: 'RUN_FAILED',
      taskId: task.id,
      actorType: 'runner',
      payload: {
        task_id: task.id,
        error: task.fail_reason ?? 'Forced failure for cloud control plane',
        retryable: task.retryable !== false,
        failure_kind: task.retryable === false ? 'failed' : 'retryable_failed',
        terminal_reason: 'execution_failed',
      },
      correlationId: task.id,
      causationId: task.id,
    });
    return;
  }

  await appendTaskEvent(env.DB, {
    taskId: task.id,
    eventType: 'STATUS_REPORTED',
    source: 'runner',
    payload: {
      task_id: task.id,
      status: 'running',
      phase: 'dispatched',
      summary: task.summary ?? `Task ${task.id} dispatched`,
    },
  });
  await appendTaskEvent(env.DB, {
    taskId: task.id,
    eventType: 'RUN_SUCCEEDED',
    source: 'runner',
    payload: {
      task_id: task.id,
      summary: task.summary ?? 'Task accepted by Cloudflare control plane',
    },
  });
  await bridgeLegacyEvent(env.DB, {
    tenantId: String(task.tenant_id ?? 'default'),
    legacyType: 'RUN_SUCCEEDED',
    taskId: task.id,
    actorType: 'runner',
    payload: {
      task_id: task.id,
      summary: task.summary ?? 'Task accepted by Cloudflare control plane',
    },
    correlationId: task.id,
    causationId: task.id,
  });
}

async function applyAction(env: Env, taskId: string, action: string, projection: any, body: any, tenantId = 'default') {
  const actor = body?.actor ?? 'surface_api';
  const requestedAt = new Date().toISOString();
  const reason = body?.reason ?? `${action} requested via task-orchestrator`;

  if (action === 'approve') {
    await appendTaskEvent(env.DB, { taskId, eventType: 'APPROVAL_GRANTED', source: 'surface_api', payload: { task_id: taskId, actor, requested_at: requestedAt, summary: reason } });
    await appendTaskEvent(env.DB, { taskId, eventType: 'STATUS_REPORTED', source: 'runner', payload: { task_id: taskId, status: 'running', phase: 'approved', summary: projection.summary ?? 'Approval granted' } });
    await appendTaskEvent(env.DB, { taskId, eventType: 'RUN_SUCCEEDED', source: 'runner', payload: { task_id: taskId, summary: projection.summary ?? 'Run succeeded after approval' } });
    await bridgeLegacyEvent(env.DB, {
      tenantId,
      legacyType: 'APPROVAL_GRANTED',
      taskId,
      actorType: 'user',
      actorId: actor,
      payload: { task_id: taskId, actor, requested_at: requestedAt, summary: reason },
      correlationId: taskId,
      causationId: taskId,
    });
    await bridgeLegacyEvent(env.DB, {
      tenantId,
      legacyType: 'task.started',
      taskId,
      actorType: 'runner',
      payload: { task_id: taskId, summary: projection.summary ?? 'Approval granted' },
      correlationId: taskId,
      causationId: taskId,
    });
    await bridgeLegacyEvent(env.DB, {
      tenantId,
      legacyType: 'RUN_SUCCEEDED',
      taskId,
      actorType: 'runner',
      payload: { task_id: taskId, summary: projection.summary ?? 'Run succeeded after approval' },
      correlationId: taskId,
      causationId: taskId,
    });
    return 'succeeded';
  }

  if (action === 'reject') {
    await appendTaskEvent(env.DB, { taskId, eventType: 'APPROVAL_REJECTED', source: 'surface_api', payload: { task_id: taskId, actor, requested_at: requestedAt, reason } });
    await appendTaskEvent(env.DB, { taskId, eventType: 'STATUS_REPORTED', source: 'runner', payload: { task_id: taskId, status: 'rejected', phase: 'rejected', summary: reason } });
    await bridgeLegacyEvent(env.DB, {
      tenantId,
      legacyType: 'APPROVAL_REJECTED',
      taskId,
      actorType: 'user',
      actorId: actor,
      payload: { task_id: taskId, actor, requested_at: requestedAt, reason, summary: reason },
      correlationId: taskId,
      causationId: taskId,
    });
    return 'rejected';
  }

  if (action === 'cancel') {
    await appendTaskEvent(env.DB, { taskId, eventType: 'RUN_CANCELLED', source: 'surface_api', payload: { task_id: taskId, actor, requested_at: requestedAt, reason } });
    await appendTaskEvent(env.DB, { taskId, eventType: 'STATUS_REPORTED', source: 'runner', payload: { task_id: taskId, status: 'cancelled', phase: 'cancelled', summary: reason } });
    await bridgeLegacyEvent(env.DB, {
      tenantId,
      legacyType: 'RUN_CANCELLED',
      taskId,
      actorType: 'user',
      actorId: actor,
      payload: { task_id: taskId, actor, requested_at: requestedAt, reason, summary: reason },
      correlationId: taskId,
      causationId: taskId,
    });
    return 'cancelled';
  }

  if (action === 'retry') {
    await appendTaskEvent(env.DB, { taskId, eventType: 'RETRY_REQUESTED', source: 'surface_api', payload: { task_id: taskId, actor, requested_at: requestedAt, reason } });
    await appendTaskEvent(env.DB, { taskId, eventType: 'STATUS_REPORTED', source: 'runner', payload: { task_id: taskId, status: 'running', phase: 'retry_requested', summary: reason } });
    await appendTaskEvent(env.DB, { taskId, eventType: 'RUN_SUCCEEDED', source: 'runner', payload: { task_id: taskId, summary: 'Run succeeded after retry' } });
    await bridgeLegacyEvent(env.DB, {
      tenantId,
      legacyType: 'RETRY_REQUESTED',
      taskId,
      actorType: 'user',
      actorId: actor,
      payload: { task_id: taskId, actor, requested_at: requestedAt, reason, summary: reason },
      correlationId: taskId,
      causationId: taskId,
    });
    await bridgeLegacyEvent(env.DB, {
      tenantId,
      legacyType: 'task.started',
      taskId,
      actorType: 'runner',
      payload: { task_id: taskId, summary: reason },
      correlationId: taskId,
      causationId: taskId,
    });
    await bridgeLegacyEvent(env.DB, {
      tenantId: String(projection.tenant_id ?? 'default'),
      legacyType: 'RUN_SUCCEEDED',
      taskId,
      actorType: 'runner',
      payload: { task_id: taskId, summary: 'Run succeeded after retry' },
      correlationId: taskId,
      causationId: taskId,
    });
    return 'succeeded';
  }

  return 'unknown';
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  await ensureNuxonRuntimeTables(env.DB);
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const tenantScope = await resolveTenantScope(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: makeCorsHeaders(origin) });
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    return json({ status: 'ok', service: 'task-orchestrator', runtime: 'cloudflare', storage: 'd1' }, 200, origin);
  }

  if (request.method === 'GET' && url.pathname === '/') {
    return json(buildServiceIndex(), 200, origin);
  }

  if (request.method === 'POST' && url.pathname === '/v1/runners/cloud') {
    if (!tenantScope) {
      return json({ error: 'tenant_scope_required', code: 'tenant_scope_required' }, 401, origin);
    }
    const body = (await request.json().catch(() => ({}))) as { runnerId?: string };
    const runnerId = String(body.runnerId ?? makeId('cloud-runner')).trim();
    const payload = await initCloudRunner(env, { runnerId, tenantId: tenantScope });
    return json({ ok: true, ...payload }, 200, origin);
  }

  const runnerStateMatch = url.pathname.match(/^\/v1\/runners\/([^/]+)$/);
  if (request.method === 'GET' && runnerStateMatch) {
    if (!tenantScope) {
      return json({ error: 'runner_not_found', code: 'runner_not_found', runner_id: decodeURIComponent(runnerStateMatch[1]) }, 404, origin);
    }
    const runnerId = decodeURIComponent(runnerStateMatch[1]);
    try {
      return json(await getCloudRunnerState(env, { runnerId, tenantId: tenantScope }), 200, origin);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'runner_not_found', code: 'runner_not_found', runner_id: runnerId }, 404, origin);
    }
  }

  const runnerAttachMatch = url.pathname.match(/^\/v1\/runners\/([^/]+)\/sessions\/([^/]+)\/attach$/);
  if (request.method === 'POST' && runnerAttachMatch) {
    if (!tenantScope) {
      return json({ error: 'tenant_scope_required', code: 'tenant_scope_required' }, 401, origin);
    }
    const runnerId = decodeURIComponent(runnerAttachMatch[1]);
    const sessionId = decodeURIComponent(runnerAttachMatch[2]);
    const payload = await attachSessionToCloudRunner(env, {
      runnerId,
      tenantId: tenantScope,
      sessionId,
    });
    if (env.RUNNER_SESSIONS) {
      await initSessionActor(env, {
        sessionId,
        tenantId: tenantScope,
        runnerId,
        phase: 'attached',
      });
      await mergeSessionActorState(env, {
        sessionId,
        tenantId: tenantScope,
        patch: {
          runnerId,
          phase: 'attached',
        },
      });
      await upsertSessionActorSlot(env, {
        sessionId,
        tenantId: tenantScope,
        key: 'runner_mode',
        value: 'cloud',
      });
      await upsertSessionActorSlot(env, {
        sessionId,
        tenantId: tenantScope,
        key: 'cloud_runner_id',
        value: runnerId,
      });
      await appendSessionActorEvent(env, {
        sessionId,
        tenantId: tenantScope,
        type: 'session.attached',
        actor: 'system',
        payload: {
          runnerId,
          sessionId,
          correlationId: sessionId,
          causationId: runnerId,
        },
      });
      await appendSessionActorEvent(env, {
        sessionId,
        tenantId: tenantScope,
        type: 'runner.attached',
        actor: 'runner',
        payload: {
          runnerId,
          sessionId,
          correlationId: sessionId,
          causationId: runnerId,
        },
      });
    }
    return json({ ok: true, ...payload }, 200, origin);
  }

  const runnerExecMatch = url.pathname.match(/^\/v1\/runners\/([^/]+)\/exec$/);
  if (request.method === 'POST' && runnerExecMatch) {
    if (!tenantScope) {
      return json({ error: 'tenant_scope_required', code: 'tenant_scope_required' }, 401, origin);
    }
    const runnerId = decodeURIComponent(runnerExecMatch[1]);
    const body = (await request.json().catch(() => ({}))) as RunnerExecRequest;
    if (!body.sessionId || !body.command) {
      return json({ error: 'session_id_and_command_required', code: 'session_id_and_command_required' }, 400, origin);
    }
    const payload = await execCloudRunner(env, {
      runnerId,
      tenantId: tenantScope,
      request: {
        ...body,
        tenantId: tenantScope,
        correlationId: body.correlationId ?? body.sessionId,
        causationId: body.causationId ?? body.sessionId,
      },
    });
    return json({ ok: payload.ok, ...(payload.payload as Record<string, unknown> | null) }, payload.status, origin);
  }

  const sessionExecMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/exec$/);
  if (request.method === 'POST' && sessionExecMatch) {
    if (!tenantScope) {
      return json({ error: 'tenant_scope_required', code: 'tenant_scope_required' }, 401, origin);
    }
    const sessionId = decodeURIComponent(sessionExecMatch[1]);
    const statePayload = await getSessionActorState(env, { sessionId, tenantId: tenantScope }).catch(() => null);
    if (!statePayload?.state) {
      return json({ error: 'session_not_found', code: 'session_not_found', session_id: sessionId }, 404, origin);
    }
    const binding = projectSessionRunnerBinding(
      await listUnifiedEventsByStream(env.DB, {
        tenantId: tenantScope,
        streamId: buildStreamId('session', sessionId),
        limit: 200,
      }),
    );
    const runnerModeSlot = (statePayload.slots ?? []).find((slot: any) => slot.key === 'runner_mode');
    const runnerId = binding.runnerId ?? statePayload.state.runnerId;
    if (runnerModeSlot?.value !== 'cloud' || !runnerId) {
      return json({ error: 'cloud_runner_not_attached', code: 'cloud_runner_not_attached', session_id: sessionId }, 409, origin);
    }
    const body = (await request.json().catch(() => ({}))) as Omit<RunnerExecRequest, 'tenantId' | 'sessionId'>;
    if (!body.command) {
      return json({ error: 'command_required', code: 'command_required', session_id: sessionId }, 400, origin);
    }
    const payload = await execCloudRunner(env, {
      runnerId,
      tenantId: tenantScope,
      request: {
        sessionId,
        tenantId: tenantScope,
        command: body.command,
        args: body.args ?? [],
        checkpoint: body.checkpoint ?? null,
        correlationId: body.correlationId ?? sessionId,
        causationId: body.causationId ?? sessionId,
      },
    });
    return json(
      {
        ok: payload.ok,
        runner_id: runnerId,
        session_id: sessionId,
        ...((payload.payload as Record<string, unknown> | null) ?? {}),
      },
      payload.status,
      origin,
    );
  }

  if (request.method === 'POST' && (url.pathname === '/v1/runners/connect' || url.pathname === '/v1/runners/heartbeat')) {
    const body = (await request.json().catch(() => ({}))) as RunnerConnectRequest;
    const runnerId = String(body.runner_id ?? '').trim();
    if (!runnerId) {
      return json({ ok: false, error: 'runner_id_required', code: 'runner_id_required' }, 400, origin);
    }
    const session = await upsertRunnerSession(env.DB, {
      runnerId,
      tenantId: tenantScope ?? 'default',
      tool: body.tool ?? 'custom_tool',
      runtime: body.runtime ?? 'desktop',
      interactionMode: body.interaction_mode ?? 'watch',
      installMethod: body.install_method ?? 'file_bundle',
      permissions: Array.isArray(body.permissions) ? body.permissions : [],
      status: body.status ?? (url.pathname.endsWith('/heartbeat') ? 'connected' : 'handshake_received'),
      metadata: {
        ...(body.metadata ?? {}),
        display_name:
          body.metadata?.display_name ??
          (body.tool === 'terminal_codex' ? '本地终端 Codex' : undefined),
        endpoint: url.pathname.endsWith('/heartbeat') ? 'heartbeat' : 'connect',
      },
    });
    await bridgeLegacyEvent(env.DB, {
      tenantId: String(session?.tenant_id ?? tenantScope ?? 'default'),
      legacyType: 'runner_connected',
      runnerId,
      actorType: 'runner',
      actorId: runnerId,
      payload: {
        runner_id: runnerId,
        tool: body.tool ?? 'custom_tool',
        runtime: body.runtime ?? 'desktop',
        endpoint: url.pathname.endsWith('/heartbeat') ? 'heartbeat' : 'connect',
      },
      correlationId: runnerId,
      causationId: runnerId,
    });
    return json({ ok: true, session: buildRunnerVerifyState(session) }, 200, origin);
  }

  if (request.method === 'GET' && url.pathname === '/v1/runners/status') {
    const runnerId = url.searchParams.get('runner_id');
    const tool = url.searchParams.get('tool');
    const runtime = url.searchParams.get('runtime');
    const session = runnerId
      ? await getRunnerSession(env.DB, runnerId)
      : tool && runtime
        ? await findRunnerSession(env.DB, { tool, runtime })
        : null;
    return json({ ok: true, session: buildRunnerVerifyState(session) }, 200, origin);
  }

  if (request.method === 'GET' && url.pathname === '/v1/tentacles') {
    if (!tenantScope) {
      return json({ ok: true, items: [], counts: { total: 0, connected: 0, with_conversation: 0 } }, 200, origin);
    }
    const sessions = await listRunnerSessions(env.DB, tenantScope);
    const items = await Promise.all(sessions.map((session) => buildTentacleAsset(env, session)));
    return json(
      {
        ok: true,
        items,
        counts: {
          total: items.length,
          connected: items.filter((item) => item.connected).length,
          with_conversation: items.filter((item) => Boolean(item.conversation_id)).length,
        },
      },
      200,
      origin,
    );
  }

  const tentacleMatch = url.pathname.match(/^\/v1\/tentacles\/([^/]+)$/);
  if (request.method === 'GET' && tentacleMatch) {
    if (!tenantScope) {
      return json({ ok: false, error: 'tentacle_not_found', code: 'tentacle_not_found', tentacle_id: decodeURIComponent(tentacleMatch[1]) }, 404, origin);
    }
    const tentacleId = decodeURIComponent(tentacleMatch[1]);
    const session = await getRunnerSession(env.DB, tentacleId);
    if (!session || String(session.tenant_id ?? 'default') !== tenantScope) {
      return json({ ok: false, error: 'tentacle_not_found', code: 'tentacle_not_found', tentacle_id: tentacleId }, 404, origin);
    }
    const tentacle = await buildTentacleAsset(env, session);
    const conversation = tentacle.conversation_id ? await buildConversationPayload(env, tentacle.conversation_id) : null;
    return json({ ok: true, tentacle, conversation }, 200, origin);
  }

  const tentacleContinueMatch = url.pathname.match(/^\/v1\/tentacles\/([^/]+)\/continue$/);
  if (request.method === 'POST' && tentacleContinueMatch) {
    if (!tenantScope) {
      return json({ ok: false, error: 'tentacle_not_found', code: 'tentacle_not_found', tentacle_id: decodeURIComponent(tentacleContinueMatch[1]) }, 404, origin);
    }
    const tentacleId = decodeURIComponent(tentacleContinueMatch[1]);
    const session = await getRunnerSession(env.DB, tentacleId);
    if (!session || String(session.tenant_id ?? 'default') !== tenantScope) {
      return json({ ok: false, error: 'tentacle_not_found', code: 'tentacle_not_found', tentacle_id: tentacleId }, 404, origin);
    }

    let conversationId = session.metadata?.linked_conversation_id ?? null;
    let payload = conversationId ? await buildConversationPayload(env, conversationId) : null;
    if (payload && !conversationMatchesTenant(payload.conversation, tenantScope)) {
      payload = null;
      conversationId = null;
    }
    if (!payload) {
      const conversation = await createConversation(env.DB, {
        tenantId: tenantScope,
        title: buildTentacleDisplayName(session),
        tool: session.tool,
        interactionMode: session.interaction_mode,
        runtime: session.runtime,
        permissions: session.permissions ?? [],
      });
      await appendConversationMessage(env.DB, {
        conversationId: conversation.conversation_id,
        role: 'assistant',
        content: buildConversationWelcome(session.tool, session.runtime, session.interaction_mode),
        source: 'system',
        metadata: {
          runner_id: session.runner_id,
          tentacle_id: session.runner_id,
        },
      });
      await updateRunnerSessionMetadata(env.DB, session.runner_id, {
        linked_conversation_id: conversation.conversation_id,
        display_name: buildTentacleDisplayName(session),
      });
      conversationId = conversation.conversation_id;
      payload = await buildConversationPayload(env, conversationId);
    }

    const refreshedSession = await getRunnerSession(env.DB, session.runner_id);
    const tentacle = await buildTentacleAsset(env, refreshedSession ?? session);
    if (payload?.conversation) {
      await bridgeLegacyEvent(env.DB, {
        tenantId: tenantScope,
        legacyType: 'continue_conversation_succeeded',
        sessionId: payload.conversation.id,
        conversationId: payload.conversation.id,
        runnerId: session.runner_id,
        actorType: 'system',
        payload: {
          conversationId: payload.conversation.id,
          runnerId: session.runner_id,
          summary: payload.conversation.title ?? buildConversationTitle(payload.conversation.tool),
        },
        correlationId: payload.conversation.id,
        causationId: session.runner_id,
      });
      await recoverConversationSessionActor(env, {
        tenantId: tenantScope,
        conversationId: payload.conversation.id,
        runnerId: session.runner_id,
        conversation: payload.conversation,
        latestTask: payload.latest_task ?? null,
        sessionPhase: payload.latest_task?.requires_human_action ? 'awaiting_approval' : 'attached',
      });
    }
    return json(
      {
        ok: true,
        tentacle,
        conversation: payload,
        latest_task: payload?.latest_task ?? null,
      },
      200,
      origin,
    );
  }

  if (request.method === 'POST' && url.pathname === '/v1/sessions/init') {
    if (!tenantScope) {
      return json({ error: 'tenant_scope_required', code: 'tenant_scope_required' }, 401, origin);
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const sessionId = String(body.sessionId ?? '').trim();
    const runnerId = String(body.runnerId ?? '').trim();
    if (!sessionId || !runnerId) {
      return json({ error: 'session_id_and_runner_id_required', code: 'session_id_and_runner_id_required' }, 400, origin);
    }
    const payload = await initSessionActor(env, {
      sessionId,
      tenantId: tenantScope,
      runnerId,
      repo: (body.repo as string | undefined) ?? null,
      branch: (body.branch as string | undefined) ?? null,
      cwd: (body.cwd as string | undefined) ?? null,
      goal: (body.goal as string | undefined) ?? null,
      summary: (body.summary as string | undefined) ?? null,
      phase: (body.phase as any) ?? 'idle',
    });
    return json(payload, 200, origin);
  }

  const sessionMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/(state|slots|events|checkpoint)$/);
  const sessionUnifiedMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/unified-events$/);
  if (request.method === 'GET' && sessionUnifiedMatch) {
    if (!tenantScope) {
      return json({ error: 'session_not_found', code: 'session_not_found', session_id: decodeURIComponent(sessionUnifiedMatch[1]) }, 404, origin);
    }
    const sessionId = decodeURIComponent(sessionUnifiedMatch[1]);
    const streamId = buildStreamId('session', sessionId);
    const limit = Number(url.searchParams.get('limit') ?? 200) || 200;
    const items = await listUnifiedEventsByStream(env.DB, { tenantId: tenantScope, streamId, limit });
    return json({ ok: true, stream_id: streamId, items, projections: summarizeUnifiedProjections(items) }, 200, origin);
  }

  const streamMatch = url.pathname.match(/^\/v1\/events\/streams\/(.+)$/);
  if (request.method === 'GET' && streamMatch) {
    if (!tenantScope) {
      return json({ ok: true, stream_id: decodeURIComponent(streamMatch[1]), items: [], projections: summarizeUnifiedProjections([]) }, 200, origin);
    }
    const streamId = decodeURIComponent(streamMatch[1]);
    const limit = Number(url.searchParams.get('limit') ?? 200) || 200;
    const items = await listUnifiedEventsByStream(env.DB, { tenantId: tenantScope, streamId, limit });
    return json({ ok: true, stream_id: streamId, items, projections: summarizeUnifiedProjections(items) }, 200, origin);
  }

  if (sessionMatch) {
    if (!tenantScope) {
      return json({ error: 'session_not_found', code: 'session_not_found', session_id: decodeURIComponent(sessionMatch[1]) }, 404, origin);
    }
    const sessionId = decodeURIComponent(sessionMatch[1]);
    const resource = sessionMatch[2];
    try {
      if (request.method === 'GET' && resource === 'state') {
        return json(await getSessionActorState(env, { sessionId, tenantId: tenantScope }), 200, origin);
      }
      if (request.method === 'POST' && resource === 'slots') {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const payload = await upsertSessionActorSlot(env, {
          sessionId,
          tenantId: tenantScope,
          key: String(body.key ?? ''),
          value: body.value,
          confidence: typeof body.confidence === 'number' ? body.confidence : null,
          sourceEventId: typeof body.sourceEventId === 'string' ? body.sourceEventId : null,
        });
        return json(payload, 200, origin);
      }
      if (request.method === 'GET' && resource === 'events') {
        const limit = Number(url.searchParams.get('limit') ?? 0) || undefined;
        return json(
          await listSessionActorEvents(env, {
            sessionId,
            tenantId: tenantScope,
            limit,
          }),
          200,
          origin,
        );
      }
      if (request.method === 'POST' && resource === 'events') {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const payload = await appendSessionActorEvent(env, {
          sessionId,
          tenantId: tenantScope,
          type: String(body.type ?? ''),
          actor: (body.actor as any) ?? 'system',
          payload: (body.payload as Record<string, unknown> | undefined) ?? {},
        });
        return json(payload, 200, origin);
      }
      if (request.method === 'POST' && resource === 'checkpoint') {
        return json(await saveSessionActorCheckpoint(env, { sessionId, tenantId: tenantScope }), 200, origin);
      }
      if (request.method === 'GET' && resource === 'checkpoint') {
        return json(await getSessionActorCheckpoint(env, { sessionId, tenantId: tenantScope }), 200, origin);
      }
    } catch (error) {
      return json(
        {
          error: error instanceof Error ? error.message : 'session_actor_error',
          code: 'session_actor_error',
          session_id: sessionId,
        },
        500,
        origin,
      );
    }
  }

  if (request.method === 'POST' && url.pathname === '/v1/conversations/open') {
    const body = (await request.json().catch(() => ({}))) as ConversationOpenRequest;
    const tool = body.tool ?? 'custom_tool';
    const interactionMode = body.interaction_mode ?? 'watch';
    const runtime = body.runtime ?? 'desktop';
    const permissions = Array.isArray(body.permissions) ? body.permissions : [];
    const conversation = await createConversation(env.DB, {
      tenantId: tenantScope ?? 'default',
      title: body.title ?? buildConversationTitle(tool),
      tool,
      interactionMode,
      runtime,
      permissions,
    });
    const existing = await buildConversationPayload(env, conversation.conversation_id);
    if (!existing?.messages?.length) {
      await appendConversationMessage(env.DB, {
        conversationId: conversation.conversation_id,
        role: 'assistant',
        content: buildConversationWelcome(tool, runtime, interactionMode),
        source: 'system',
        metadata: {
          tool,
          runtime,
          interaction_mode: interactionMode,
        },
      });
    }
    await maybeLinkRunnerConversation(env, tenantScope ?? 'default', conversation.conversation_id, tool, runtime);
    const payload = await buildConversationPayload(env, conversation.conversation_id);
    if (payload?.conversation) {
      const runnerSession = await findRunnerSession(env.DB, {
        tool,
        runtime,
        tenantId: tenantScope ?? 'default',
        maxAgeSeconds: 86400,
      });
      await ensureConversationSessionActor(env, {
        tenantId: tenantScope ?? 'default',
        conversationId: conversation.conversation_id,
        runnerId: runnerSession?.runner_id ?? 'runner-unbound',
        conversation: payload.conversation,
        latestTask: payload.latest_task ?? null,
        sessionPhase: 'attached',
      });
    }
    return json(payload, 200, origin);
  }

  const conversationMatch = url.pathname.match(/^\/v1\/conversations\/([^/]+)$/);
  if (request.method === 'GET' && conversationMatch) {
    const conversationId = decodeURIComponent(conversationMatch[1]);
    const payload = await buildConversationPayload(env, conversationId);
    if (!payload || !conversationMatchesTenant(payload.conversation, tenantScope ?? 'default')) {
      return json({ error: 'conversation_not_found', code: 'conversation_not_found', conversation_id: conversationId }, 404, origin);
    }
    return json(payload, 200, origin);
  }

  const conversationMessageMatch = url.pathname.match(/^\/v1\/conversations\/([^/]+)\/messages$/);
  if (request.method === 'POST' && conversationMessageMatch) {
    const conversationId = decodeURIComponent(conversationMessageMatch[1]);
    const conversation = await getConversation(env.DB, conversationId);
    if (!conversation || !conversationMatchesTenant(conversation, tenantScope ?? 'default')) {
      return json({ error: 'conversation_not_found', code: 'conversation_not_found', conversation_id: conversationId }, 404, origin);
    }
    const body = (await request.json().catch(() => ({}))) as { content?: string; actor?: string };
    const content = String(body.content ?? '').trim();
    if (!content) {
      return json({ error: 'content_required', code: 'content_required', conversation_id: conversationId }, 400, origin);
    }
    const actor = String(body.actor ?? 'user');
    await appendConversationMessage(env.DB, {
      conversationId,
      role: 'user',
      content,
      source: 'surface_api',
      metadata: {
        actor,
        requested_at: new Date().toISOString(),
      },
    });

    const compiled = buildTaskFromInput(content);
    await maybeLinkRunnerConversation(env, tenantScope ?? 'default', conversationId, conversation.tool, conversation.runtime);
    const approvalRequired =
      compiled.task.policy.approval_before_mutation ||
      (conversation.permissions ?? []).includes('modify_configuration') ||
      (conversation.permissions ?? []).includes('automatic_execution') ||
      (conversation.permissions ?? []).includes('request_approval');

    const queuedTask = {
      ...compiled.task,
      summary: `Tentacles request · ${conversation.tool}`,
      input: content,
      tenant_id: tenantScope ?? 'default',
      conversation_id: conversationId,
      selected_tool: conversation.tool,
      interaction_mode: conversation.interaction_mode,
      requested_at: new Date().toISOString(),
      approval_before_mutation: approvalRequired,
      status: 'queued',
      phase: 'queued',
      dispatched_at: new Date().toISOString(),
    };
    await saveTaskRecord(env.DB, { task: queuedTask, connection: compiled.connection, handshake: compiled.handshake, tenantId: tenantScope ?? 'default' });
    await bridgeLegacyEvent(env.DB, {
      tenantId: tenantScope ?? 'default',
      legacyType: 'task_created',
      taskId: queuedTask.id,
      sessionId: conversationId,
      conversationId,
      actorType: 'user',
      actorId: actor,
      payload: {
        task_id: queuedTask.id,
        summary: queuedTask.summary,
        input: content,
      },
      correlationId: conversationId,
      causationId: conversationId,
    });
    await ensureConversationSessionActor(env, {
      tenantId: tenantScope ?? 'default',
      conversationId,
      runnerId: String(conversationId),
      conversation,
      latestTask: queuedTask,
      sessionPhase: approvalRequired ? 'awaiting_approval' : 'running',
    });
    await appendSessionActorEvent(env, {
      sessionId: conversationId,
      tenantId: tenantScope ?? 'default',
      type: 'task.created',
      actor: 'user',
      payload: {
        taskId: queuedTask.id,
        task_id: queuedTask.id,
        input: content,
        summary: queuedTask.summary,
        approval_required: approvalRequired,
      },
    });
    if (approvalRequired) {
      await bridgeLegacyEvent(env.DB, {
        tenantId: tenantScope ?? 'default',
        legacyType: 'APPROVAL_REQUIRED',
        taskId: queuedTask.id,
        sessionId: conversationId,
        conversationId,
        actorType: 'runner',
        payload: {
          task_id: queuedTask.id,
          summary: queuedTask.summary,
        },
        correlationId: queuedTask.id,
        causationId: conversationId,
      });
      await appendSessionActorEvent(env, {
        sessionId: conversationId,
        tenantId: tenantScope ?? 'default',
        type: 'approval.requested',
        actor: 'runner',
        payload: {
          taskId: queuedTask.id,
          task_id: queuedTask.id,
          summary: queuedTask.summary,
        },
      });
    } else {
      await bridgeLegacyEvent(env.DB, {
        tenantId: tenantScope ?? 'default',
        legacyType: 'task.started',
        taskId: queuedTask.id,
        sessionId: conversationId,
        conversationId,
        actorType: 'runner',
        payload: {
          task_id: queuedTask.id,
          summary: queuedTask.summary,
        },
        correlationId: queuedTask.id,
        causationId: conversationId,
      });
      await appendSessionActorEvent(env, {
        sessionId: conversationId,
        tenantId: tenantScope ?? 'default',
        type: 'task.started',
        actor: 'runner',
        payload: {
          taskId: queuedTask.id,
          task_id: queuedTask.id,
          summary: queuedTask.summary,
        },
      });
    }
    await runCloudControlPlaneDispatch(env, queuedTask);
    const projectionPayload = await readProjection(env, queuedTask.id);
    if (projectionPayload.task) {
      await updateTaskSnapshot(env.DB, queuedTask.id, projectionPayload.task);
    }
    await bridgeLegacyEvent(env.DB, {
      tenantId: tenantScope ?? 'default',
      legacyType:
        projectionPayload.task?.status === 'failed' || projectionPayload.task?.status === 'retryable_failed'
          ? 'RUN_FAILED'
          : projectionPayload.task?.status === 'awaiting_approval'
            ? 'APPROVAL_REQUIRED'
            : 'RUN_SUCCEEDED',
      taskId: queuedTask.id,
      sessionId: conversationId,
      conversationId,
      actorType: 'runner',
      payload: {
        task_id: queuedTask.id,
        summary: projectionPayload.task?.summary ?? queuedTask.summary,
        status: projectionPayload.task?.status ?? queuedTask.status,
      },
      correlationId: queuedTask.id,
      causationId: queuedTask.id,
    });
    await appendSessionActorEvent(env, {
      sessionId: conversationId,
      tenantId: tenantScope ?? 'default',
      type: projectionPayload.task?.status === 'failed' || projectionPayload.task?.status === 'retryable_failed' ? 'task.failed' : projectionPayload.task?.status === 'awaiting_approval' ? 'approval.requested' : 'task.succeeded',
      actor: 'runner',
      payload: {
        taskId: queuedTask.id,
        task_id: queuedTask.id,
        summary: projectionPayload.task?.summary ?? queuedTask.summary,
        phase: projectionPayload.task?.status === 'succeeded' ? 'completed' : undefined,
      },
    });
    await saveSessionActorCheckpoint(env, {
      sessionId: conversationId,
      tenantId: tenantScope ?? 'default',
    });
    await appendConversationMessage(env.DB, {
      conversationId,
      role: 'assistant',
      content: buildAssistantSummary(projectionPayload.task ?? queuedTask, conversation.tool),
      source: 'runner',
      taskId: queuedTask.id,
      metadata: {
        task_status: projectionPayload.task?.status ?? queuedTask.status,
        requested_at: queuedTask.requested_at,
      },
    });
    return json({
      ok: true,
      conversation: await buildConversationPayload(env, conversationId),
      dispatched_task_id: queuedTask.id,
      projection: projectionPayload.task ?? null,
    }, 200, origin);
  }

  if (request.method === 'POST' && url.pathname === '/v1/handshake/generate') {
    const body = (await request.json().catch(() => ({}))) as HandshakeRequest;
    return json(buildHandshakeResponse(body), 200, origin);
  }

  if (request.method === 'GET' && url.pathname === '/v1/handshake/download') {
    const requestPayload: HandshakeRequest = {
      tool: url.searchParams.get('tool') ?? undefined,
      interaction_mode: url.searchParams.get('interaction_mode') ?? undefined,
      runtime: url.searchParams.get('runtime') ?? undefined,
      permissions: (url.searchParams.get('permissions') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    };
    const payload = buildHandshakeResponse(requestPayload);
    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="nuxon-handshake-${slugify(payload.selected_tool)}.json"`,
        ...makeCorsHeaders(origin),
      },
    });
  }

  if (request.method === 'GET' && url.pathname === '/v1/tasks/projection') {
    const taskId = url.searchParams.get('task_id') ?? undefined;
    const payload = await readProjection(env, taskId);
    const status = taskId && payload?.error === 'task_not_found' ? 404 : 200;
    return json(payload, status, origin);
  }

  if (request.method === 'POST' && url.pathname === '/v1/tasks/dispatch') {
    const body = (await request.json()) as { input?: string; task?: Record<string, unknown> };
    let compiled;

    if (typeof body.input === 'string' && body.input.trim()) {
      compiled = buildTaskFromInput(body.input.trim());
    } else if (body.task && typeof body.task === 'object') {
      const task = body.task as Record<string, unknown>;
      const input = String(task.input ?? task.summary ?? '').trim();
      if (!input) return json({ error: 'input_required' }, 400, origin);
      compiled = buildTaskFromInput(input);
      compiled.task = {
        ...compiled.task,
        ...task,
        id: String(task.id ?? compiled.task.id),
        updated_at: new Date().toISOString(),
      };
    } else {
      return json({ error: 'input_required' }, 400, origin);
    }

    const queuedTask = {
      ...compiled.task,
      tenant_id: tenantScope ?? 'default',
      approval_before_mutation: compiled.task.policy.approval_before_mutation,
      status: 'queued',
      phase: 'queued',
      dispatched_at: new Date().toISOString(),
    };
    await saveTaskRecord(env.DB, { task: queuedTask, connection: compiled.connection, handshake: compiled.handshake, tenantId: tenantScope ?? 'default' });
    await bridgeLegacyEvent(env.DB, {
      tenantId: tenantScope ?? 'default',
      legacyType: 'task_created',
      taskId: queuedTask.id,
      actorType: 'user',
      payload: {
        task_id: queuedTask.id,
        summary: queuedTask.summary,
        input: queuedTask.input,
      },
      correlationId: queuedTask.id,
      causationId: queuedTask.id,
    });
    await runCloudControlPlaneDispatch(env, queuedTask);
    const projectionPayload = await readProjection(env, queuedTask.id);
    if (projectionPayload.task) {
      await updateTaskSnapshot(env.DB, queuedTask.id, projectionPayload.task);
    }
    return json({
      task: queuedTask,
      connection: compiled.connection,
      handshake: compiled.handshake,
      dispatch_result: {
        queued: true,
        mode: 'cloudflare_control_plane',
        applied: true,
      },
      projection: projectionPayload.task ?? null,
      next_actions: ['observe_projection'],
      surface: await readProjection(env),
    }, 200, origin);
  }

  const actionMatch = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/actions\/(approve|reject|cancel|retry)$/);
  if (request.method === 'POST' && actionMatch) {
    const taskId = decodeURIComponent(actionMatch[1]);
    const action = actionMatch[2];
    const surface = await readProjection(env, taskId);
    if (surface?.error === 'task_not_found' || !surface?.task) {
      return json({ ok: false, error: 'task_not_found', code: 'task_not_found', task_id: taskId, action }, 404, origin);
    }

    const whyNotAllowed = explainActionAvailability(surface.task.status, action, surface.task);
    if (!whyNotAllowed.allowed) {
      return json({ ok: false, error: 'action_not_allowed', code: 'action_not_allowed', task_id: taskId, action, why_not_allowed: whyNotAllowed }, 409, origin);
    }

    const body = await request.json().catch(() => ({}));
    const nextState = await applyAction(env, taskId, action, surface.task, body, tenantScope ?? 'default');
    const taskRecord = await getTaskRecord(env.DB, taskId);
    const projectionPayload = await readProjection(env, taskId);
    if (projectionPayload.task) {
      await updateTaskSnapshot(env.DB, taskId, projectionPayload.task);
    }
    const conversationId = taskRecord?.task?.conversation_id ?? null;
    if (conversationId) {
      if (action === 'approve') {
        await appendSessionActorEvent(env, {
          sessionId: conversationId,
          tenantId: tenantScope ?? 'default',
          type: 'approval.granted',
          actor: 'user',
          payload: { taskId, task_id: taskId, summary: body?.reason ?? 'Approval granted' },
        });
        await appendSessionActorEvent(env, {
          sessionId: conversationId,
          tenantId: tenantScope ?? 'default',
          type: 'task.started',
          actor: 'runner',
          payload: { taskId, task_id: taskId, summary: projectionPayload.task?.summary ?? surface.task.summary },
        });
      } else if (action === 'reject') {
        await appendSessionActorEvent(env, {
          sessionId: conversationId,
          tenantId: tenantScope ?? 'default',
          type: 'approval.rejected',
          actor: 'user',
          payload: { taskId, task_id: taskId, summary: body?.reason ?? 'Approval rejected', phase: 'blocked' },
        });
      } else if (action === 'cancel') {
        await appendSessionActorEvent(env, {
          sessionId: conversationId,
          tenantId: tenantScope ?? 'default',
          type: 'task.cancelled',
          actor: 'user',
          payload: { taskId, task_id: taskId, summary: body?.reason ?? 'Task cancelled', phase: 'blocked' },
        });
      } else if (action === 'retry') {
        await appendSessionActorEvent(env, {
          sessionId: conversationId,
          tenantId: tenantScope ?? 'default',
          type: 'task.started',
          actor: 'runner',
          payload: { taskId, task_id: taskId, summary: body?.reason ?? 'Retry requested' },
        });
      }
      await appendSessionActorEvent(env, {
        sessionId: conversationId,
        tenantId: tenantScope ?? 'default',
        type: nextState === 'succeeded' ? 'task.succeeded' : nextState === 'failed' ? 'task.failed' : nextState === 'rejected' ? 'approval.rejected' : nextState === 'cancelled' ? 'task.cancelled' : 'task.started',
        actor: 'runner',
        payload: {
          taskId,
          task_id: taskId,
          summary: projectionPayload.task?.summary ?? surface.task.summary,
          phase: nextState === 'succeeded' ? 'completed' : undefined,
        },
      });
      await saveSessionActorCheckpoint(env, {
        sessionId: conversationId,
        tenantId: tenantScope ?? 'default',
      });
    }
    if (conversationId) {
      await appendConversationMessage(env.DB, {
        conversationId,
        role: 'assistant',
        content: buildAssistantSummary(projectionPayload.task ?? surface.task, taskRecord?.task?.selected_tool ?? 'the tool'),
        source: 'runner',
        taskId,
        metadata: {
          action,
          actor: body?.actor ?? 'surface_api',
          requested_at: body?.requested_at ?? new Date().toISOString(),
          task_status: projectionPayload.task?.status ?? nextState,
        },
      });
    }
    return json({
      ok: true,
      task_id: taskId,
      action,
      enqueued: true,
      applied: true,
      next_state: nextState,
      projection: projectionPayload.task ?? null,
    }, 200, origin);
  }

  if (request.method === 'POST' && url.pathname === '/v1/tasks/compile') {
    const body = (await request.json()) as { input?: string };
    const input = String(body.input ?? '').trim();
    if (!input) return json({ error: 'input_required' }, 400, origin);
    const { task, connection, handshake } = buildTaskFromInput(input);
    return json({
      task,
      connection,
      handshake,
      next_actions: ['dispatch_task', 'view_projection'],
      surface: await readProjection(env),
    }, 200, origin);
  }

  return json({ error: 'not_found' }, 404, origin);
}

export default {
  fetch(request: Request, env: Env) {
    return handleRequest(request, env);
  },
};

export { RunnerSessionDO, CloudRunnerDO, CodexRunnerContainer };
export const sessionActorInternals = {
  ensureConversationSessionActor,
  appendConversationSessionLifecycle,
  recoverConversationSessionActor,
};
