import type { UnifiedEvent } from './event-types';

function sortEvents(events: UnifiedEvent[]): UnifiedEvent[] {
  return [...events].sort((left, right) => left.timestamp - right.timestamp);
}

export function projectSessionPhase(events: UnifiedEvent[]) {
  let phase = 'idle';
  for (const event of sortEvents(events)) {
    switch (event.eventType) {
      case 'session.initialized':
        phase = 'idle';
        break;
      case 'session.resumed':
      case 'session.attached':
      case 'conversation.attached':
      case 'runner.attached':
      case 'runner.ready':
        phase = 'attached';
        break;
      case 'approval.requested':
        phase = 'awaiting_approval';
        break;
      case 'approval.granted':
      case 'task.started':
      case 'runner.exec.started':
        phase = 'running';
        break;
      case 'task.succeeded':
      case 'runner.exec.succeeded':
        phase = 'completed';
        break;
      case 'task.failed':
      case 'runner.exec.failed':
        phase = 'failed';
        break;
      case 'approval.rejected':
      case 'task.cancelled':
        phase = 'blocked';
        break;
      default:
        break;
    }
  }
  return { phase };
}

export function projectRunnerPhase(events: UnifiedEvent[]) {
  let phase = 'idle';
  let lastExecResult = null;
  for (const event of sortEvents(events)) {
    switch (event.eventType) {
      case 'runner.requested':
        phase = 'requested';
        break;
      case 'runner.provisioning':
        phase = 'provisioning';
        break;
      case 'runner.ready':
      case 'runner.connected':
      case 'runner.attached':
      case 'container.resumed':
        phase = 'ready';
        break;
      case 'runner.exec.started':
        phase = 'executing';
        break;
      case 'runner.exec.succeeded':
        phase = 'idle';
        lastExecResult = {
          exitCode: event.payload.exitCode ?? 0,
          stdout: event.payload.stdout ?? '',
          stderr: event.payload.stderr ?? '',
        };
        break;
      case 'runner.exec.failed':
        phase = 'failed';
        lastExecResult = {
          exitCode: event.payload.exitCode ?? 1,
          stdout: event.payload.stdout ?? '',
          stderr: event.payload.stderr ?? '',
        };
        break;
      case 'runner.disconnected':
      case 'container.stopped':
        phase = 'offline';
        break;
      case 'container.sleeping':
        phase = 'sleeping';
        break;
      case 'container.started':
        phase = 'ready';
        break;
      default:
        break;
    }
  }
  return { phase, lastExecResult };
}

export function projectApprovalState(events: UnifiedEvent[]) {
  let state = 'idle';
  let taskId: string | null = null;
  for (const event of sortEvents(events)) {
    if (typeof event.payload.taskId === 'string') taskId = event.payload.taskId;
    if (typeof event.payload.task_id === 'string') taskId = event.payload.task_id;
    switch (event.eventType) {
      case 'approval.requested':
        state = 'awaiting_approval';
        break;
      case 'approval.granted':
        state = 'granted';
        break;
      case 'approval.rejected':
        state = 'rejected';
        break;
      case 'task.cancelled':
        state = 'cancelled';
        break;
      default:
        break;
    }
  }
  return { state, taskId };
}

export function projectTaskState(events: UnifiedEvent[]) {
  let status = 'queued';
  let taskId: string | null = null;
  let summary: string | null = null;
  for (const event of sortEvents(events)) {
    if (typeof event.payload.taskId === 'string') taskId = event.payload.taskId;
    if (typeof event.payload.task_id === 'string') taskId = event.payload.task_id;
    if (typeof event.payload.summary === 'string') summary = event.payload.summary;
    switch (event.eventType) {
      case 'task.created':
        status = 'queued';
        break;
      case 'approval.requested':
        status = 'awaiting_approval';
        break;
      case 'task.started':
      case 'runner.exec.started':
        status = 'running';
        break;
      case 'task.succeeded':
      case 'runner.exec.succeeded':
        status = 'succeeded';
        break;
      case 'task.failed':
      case 'runner.exec.failed':
        status = 'failed';
        break;
      case 'task.cancelled':
        status = 'cancelled';
        break;
      default:
        break;
    }
  }
  return { taskId, status, summary };
}

export function summarizeUnifiedProjections(events: UnifiedEvent[]) {
  return {
    session: projectSessionPhase(events),
    runner: projectRunnerPhase(events),
    sessionRunnerBinding: projectSessionRunnerBinding(events),
    approval: projectApprovalState(events),
    task: projectTaskState(events),
  };
}

export function projectSessionRunnerBinding(events: UnifiedEvent[]) {
  let runnerId = null;
  let sessionId = null;
  let attached = false;
  for (const event of sortEvents(events)) {
    if (typeof event.payload.runnerId === 'string') runnerId = event.payload.runnerId;
    if (typeof event.payload.sessionId === 'string') sessionId = event.payload.sessionId;
    if (event.eventType === 'session.attached' || event.eventType === 'runner.attached') {
      attached = true;
    }
  }
  return { attached, runnerId, sessionId };
}
