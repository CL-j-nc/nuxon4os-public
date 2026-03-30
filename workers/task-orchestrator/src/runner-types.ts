export type RunnerPhase = 'provisioning' | 'idle' | 'busy' | 'sleeping' | 'offline' | 'failed';

export type RunnerState = {
  runnerId: string;
  tenantId: string;
  mode: 'cloud';
  provider: 'codex';
  phase: RunnerPhase;
  containerId?: string | null;
  attachedSessionId?: string | null;
  lastExecResult?: RunnerExecResult | null;
  updatedAt: string;
  createdAt: string;
};

export type RunnerExecRequest = {
  sessionId: string;
  tenantId: string;
  command: string;
  args?: string[];
  checkpoint?: string | null;
  correlationId?: string | null;
  causationId?: string | null;
};

export type RunnerExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};
