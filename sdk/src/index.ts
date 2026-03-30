/**
 * Nuxon 4 OS — AI Organization Operating Console
 * Copyright (c) 2024-2026 CL-j-nc. All Rights Reserved.
 * Licensed under the Business Source License 1.1 (BSL). See LICENSE file.
 */

/**
 * Nuxon 4 OS SDK
 *
 * AI automation in one API call.
 *
 * Usage:
 *   import { Brain } from '@nuxon4os/sdk';
 *   const brain = new Brain({ apiKey: 'cb_...' });
 *   const result = await brain.run('github', 'push', { repo: 'my/repo' });
 */

export interface BrainConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
}

export interface ExecuteParams {
  source: string;
  type: string;
  payload?: Record<string, any>;
  model?: string;
}

export interface Decision {
  action: 'execute' | 'ignore' | 'notify' | 'defer' | 'error';
  target?: string | null;
  confidence?: number;
  reason?: string | null;
}

export interface ExecuteResult {
  ok: boolean;
  event_id: string;
  decision: Decision;
  meta: {
    decided_by: 'rule_engine' | 'ai' | 'fallback';
    model_used: string | null;
    tokens_in: number;
    tokens_out: number;
    latency_ms: number;
    rule_id: number | null;
  };
}

export interface UsageResult {
  plan: string;
  period: string;
  usage: {
    calls: number;
    tokens_in: number;
    tokens_out: number;
    errors: number;
  };
  limits: {
    calls: number;
    tokens: number;
  };
  remaining: {
    calls: number;
    tokens: number;
  };
}

export interface Rule {
  id: string;
  source: string;
  event_type: string;
  action: string;
  target: string;
  confidence: number;
  status: string;
}

export interface RulesResult {
  ok: boolean;
  rules: Rule[];
}

export interface Connector {
  id: string;
  name: string;
  mode: string;
  status: string;
  endpoint: string;
}

export interface ConnectorsResult {
  ok: boolean;
  connectors: Connector[];
}

export interface DispatchResult {
  ok: boolean;
  task_id: string;
}

export interface EventRecord {
  id: string;
  source: string;
  type: string;
  subject: string;
  payload: any;
  created_at: string;
}

export interface EventsResult {
  ok: boolean;
  events: EventRecord[];
  total: number;
}

export interface MarketplaceConnector {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: string;
  category: string;
  manifest: Record<string, any>;
  adapter_spec: Record<string, any>;
  event_schemas: Array<{ event_type: string; schema: Record<string, any> }>;
  downloads: number;
  rating: number;
}

export interface MarketplaceListResult {
  ok: boolean;
  connectors: MarketplaceConnector[];
  total: number;
}

export interface InstalledConnector {
  id: string;
  connector_id: string;
  name: string;
  version: string;
  enabled: boolean;
  config: Record<string, any>;
  installed_at: string;
}

export interface InstalledListResult {
  ok: boolean;
  connectors: InstalledConnector[];
}

export interface InstallResult {
  ok: boolean;
  installed: boolean;
  installation_id: string;
}

export interface MarketplaceActionResult {
  ok: boolean;
}

export interface StreamEvent {
  type: string;
  data: any;
}

export interface StreamHandle {
  close: () => void;
}

export class BrainError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'BrainError';
    this.status = status;
  }
}

export class Brain {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;

  constructor(config: BrainConfig) {
    if (!config.apiKey) throw new Error('apiKey is required');
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'https://dashboard-api.nuxon4os.workers.dev').replace(/\/$/, '');
    this.timeout = config.timeout || 30000;
  }

  /**
   * Execute an event through the AI pipeline.
   * Returns the AI decision (execute/ignore/notify/defer).
   *
   * @example
   * const result = await brain.run('github', 'push', { repo: 'my/repo', branch: 'main' });
   * console.log(result.decision.action); // 'execute'
   */
  async run(source: string, type: string, payload?: Record<string, any>, model?: string): Promise<ExecuteResult> {
    return this.request<ExecuteResult>('/v1/execute', {
      method: 'POST',
      body: JSON.stringify({ source, type, payload, model }),
    });
  }

  /**
   * Get current usage statistics.
   */
  async usage(): Promise<UsageResult> {
    return this.request<UsageResult>('/v1/usage');
  }

  /**
   * List active learned rules with optional filters.
   */
  async rules(filters?: { status?: string; source?: string }): Promise<RulesResult> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.source) params.set('source', filters.source);
    const qs = params.toString();
    return this.request<RulesResult>(`/v1/rules${qs ? `?${qs}` : ''}`);
  }

  /**
   * List connectors.
   */
  async connectors(): Promise<ConnectorsResult> {
    return this.request<ConnectorsResult>('/v1/connectors');
  }

  /**
   * Dispatch a task to an edge agent.
   */
  async dispatch(agentId: string, taskType: string, payload: Record<string, any>): Promise<DispatchResult> {
    return this.request<DispatchResult>('/v1/edge/dispatch', {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId, type: taskType, payload }),
    });
  }

  /**
   * Query events with optional filters.
   */
  async events(filters?: { source?: string; type?: string; limit?: number; offset?: number }): Promise<EventsResult> {
    const params = new URLSearchParams();
    if (filters?.source) params.set('source', filters.source);
    if (filters?.type) params.set('type', filters.type);
    if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return this.request<EventsResult>(`/v1/events${qs ? `?${qs}` : ''}`);
  }

  /**
   * Subscribe to real-time events via SSE.
   * Returns a handle with close() to abort the connection.
   */
  stream(callback: (event: StreamEvent) => void, onError?: (err: Error) => void): StreamHandle {
    const controller = new AbortController();

    const connect = async () => {
      try {
        const res = await fetch(`${this.baseUrl}/v1/events/stream`, {
          headers: {
            'Accept': 'text/event-stream',
            'x-api-key': this.apiKey,
          },
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new BrainError(`SSE connection failed: HTTP ${res.status}`, res.status);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let eventType = 'message';
          let dataLines: string[] = [];

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trim());
            } else if (line === '') {
              // Empty line = end of event
              if (dataLines.length > 0) {
                const raw = dataLines.join('\n');
                let data: any;
                try {
                  data = JSON.parse(raw);
                } catch {
                  data = raw;
                }
                callback({ type: eventType, data });
              }
              eventType = 'message';
              dataLines = [];
            }
          }
        }
      } catch (e: any) {
        if (e.name === 'AbortError') return;
        throw e;
      }
    };

    connect().catch((err) => { if (onError) onError(err); });

    return { close: () => controller.abort() };
  }

  /**
   * Marketplace client for browsing, installing, and managing connectors.
   */
  get marketplace() {
    return {
      /** List available connectors in marketplace */
      list: (filters?: { category?: string; search?: string }): Promise<MarketplaceListResult> => {
        const params = new URLSearchParams();
        if (filters?.category) params.set('category', filters.category);
        if (filters?.search) params.set('search', filters.search);
        const qs = params.toString();
        return this.request<MarketplaceListResult>(`/v1/marketplace/connectors${qs ? `?${qs}` : ''}`);
      },

      /** Get connector details */
      get: (id: string): Promise<MarketplaceConnector> => {
        return this.request<MarketplaceConnector>(`/v1/marketplace/connectors/${encodeURIComponent(id)}`);
      },

      /** Install a connector */
      install: (connectorId: string, config?: Record<string, any>): Promise<InstallResult> => {
        return this.request<InstallResult>('/v1/marketplace/connectors/install', {
          method: 'POST',
          body: JSON.stringify({ connector_id: connectorId, config }),
        });
      },

      /** List installed connectors */
      installed: (): Promise<InstalledListResult> => {
        return this.request<InstalledListResult>('/v1/marketplace/connectors/installed');
      },

      /** Enable an installed connector */
      enable: (id: string): Promise<MarketplaceActionResult> => {
        return this.request<MarketplaceActionResult>(`/v1/marketplace/connectors/${encodeURIComponent(id)}/enable`, {
          method: 'POST',
        });
      },

      /** Disable an installed connector */
      disable: (id: string): Promise<MarketplaceActionResult> => {
        return this.request<MarketplaceActionResult>(`/v1/marketplace/connectors/${encodeURIComponent(id)}/disable`, {
          method: 'POST',
        });
      },

      /** Uninstall a connector */
      uninstall: (id: string): Promise<MarketplaceActionResult> => {
        return this.request<MarketplaceActionResult>(`/v1/marketplace/connectors/${encodeURIComponent(id)}/uninstall`, {
          method: 'DELETE',
        });
      },
    };
  }

  private async request<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...opts,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          ...opts.headers,
        },
      });

      const data = await res.json() as any;

      if (!res.ok) {
        throw new BrainError(
          data.error || `HTTP ${res.status}`,
          res.status
        );
      }

      return data as T;
    } catch (e: any) {
      if (e.name === 'AbortError') {
        throw new BrainError('Request timeout', 408);
      }
      if (e instanceof BrainError) throw e;
      throw new BrainError(e.message, 0);
    } finally {
      clearTimeout(timer);
    }
  }
}

// Convenience export
export default Brain;
