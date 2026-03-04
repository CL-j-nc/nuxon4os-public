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
interface BrainConfig {
    apiKey: string;
    baseUrl?: string;
    timeout?: number;
}
interface ExecuteParams {
    source: string;
    type: string;
    payload?: Record<string, any>;
    model?: string;
}
interface Decision {
    action: 'execute' | 'ignore' | 'notify' | 'defer' | 'error';
    target?: string | null;
    confidence?: number;
    reason?: string | null;
}
interface ExecuteResult {
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
interface UsageResult {
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
interface Rule {
    id: string;
    source: string;
    event_type: string;
    action: string;
    target: string;
    confidence: number;
    status: string;
}
interface RulesResult {
    ok: boolean;
    rules: Rule[];
}
interface Connector {
    id: string;
    name: string;
    mode: string;
    status: string;
    endpoint: string;
}
interface ConnectorsResult {
    ok: boolean;
    connectors: Connector[];
}
interface DispatchResult {
    ok: boolean;
    task_id: string;
}
interface EventRecord {
    id: string;
    source: string;
    type: string;
    subject: string;
    payload: any;
    created_at: string;
}
interface EventsResult {
    ok: boolean;
    events: EventRecord[];
    total: number;
}
interface StreamEvent {
    type: string;
    data: any;
}
interface StreamHandle {
    close: () => void;
}
declare class BrainError extends Error {
    status: number;
    constructor(message: string, status: number);
}
declare class Brain {
    private apiKey;
    private baseUrl;
    private timeout;
    constructor(config: BrainConfig);
    /**
     * Execute an event through the AI pipeline.
     * Returns the AI decision (execute/ignore/notify/defer).
     *
     * @example
     * const result = await brain.run('github', 'push', { repo: 'my/repo', branch: 'main' });
     * console.log(result.decision.action); // 'execute'
     */
    run(source: string, type: string, payload?: Record<string, any>, model?: string): Promise<ExecuteResult>;
    /**
     * Get current usage statistics.
     */
    usage(): Promise<UsageResult>;
    /**
     * List active learned rules with optional filters.
     */
    rules(filters?: {
        status?: string;
        source?: string;
    }): Promise<RulesResult>;
    /**
     * List connectors.
     */
    connectors(): Promise<ConnectorsResult>;
    /**
     * Dispatch a task to an edge agent.
     */
    dispatch(agentId: string, taskType: string, payload: Record<string, any>): Promise<DispatchResult>;
    /**
     * Query events with optional filters.
     */
    events(filters?: {
        source?: string;
        type?: string;
        limit?: number;
        offset?: number;
    }): Promise<EventsResult>;
    /**
     * Subscribe to real-time events via SSE.
     * Returns a handle with close() to abort the connection.
     */
    stream(callback: (event: StreamEvent) => void): StreamHandle;
    private request;
}

export { Brain, type BrainConfig, BrainError, type Connector, type ConnectorsResult, type Decision, type DispatchResult, type EventRecord, type EventsResult, type ExecuteParams, type ExecuteResult, type Rule, type RulesResult, type StreamEvent, type StreamHandle, type UsageResult, Brain as default };
