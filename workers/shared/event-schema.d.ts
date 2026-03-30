/**
 * Nuxon 4 OS — AI Organization Operating Console
 * Copyright (c) 2024-2026 CL-j-nc. All Rights Reserved.
 * Licensed under the Business Source License 1.1 (BSL). See LICENSE file.
 *
 * Type definitions for Event Identity Schema v3.0.
 */

export type EventEnvironment = "production" | "staging" | "development";

export interface StandardEventMetrics extends Record<string, number> {}

export interface StandardEvent {
  // --- Frozen fields (required on every event) ---
  readonly schema_version: "3.0";
  readonly event_id: string;
  readonly trace_id: string;
  readonly span_id: string;
  readonly tenant_id: string;
  readonly source: string;
  readonly type: string;
  readonly subject: string;
  readonly payload: Record<string, any>;
  readonly occurred_at: number;
  readonly ts: number;

  // --- Optional fields ---
  readonly task_id: string | null;
  readonly idempotency_key: string | null;
  readonly rollback_id: string | null;
  readonly causation_id: string | null;
  readonly connector_id: string | null;
  readonly metrics: StandardEventMetrics;
  readonly env: EventEnvironment;
}

export interface BuildEventOptions {
  /** Tenant identifier (defaults to "default" if omitted). */
  tenant_id?: string;
  source: string;
  /** Dot-separated event type. */
  type: string;
  /** Human-readable subject; defaults to `type` if omitted. */
  subject?: string;
  payload?: Record<string, any>;
  /** Epoch ms; defaults to Date.now(). */
  occurred_at?: number;
  metrics?: StandardEventMetrics;
  trace_id?: string;
  span_id?: string;
  task_id?: string;
  idempotency_key?: string;
  rollback_id?: string;
  /** event_id of the event that caused this one. */
  causation_id?: string;
  connector_id?: string;
  env?: EventEnvironment;
}

export type ValidateEventResult =
  | { valid: true }
  | { valid: false; errors: string[] };

export declare function buildEvent(opts: BuildEventOptions): StandardEvent;

/**
 * Validates an event against the frozen schema.
 * Accepts both v2.1 and v3.0 events for backward compatibility.
 */
export declare function validateEvent(event: any): ValidateEventResult;

/**
 * Upgrades a v2.1 event to v3.0 by filling missing fields with defaults.
 * Returns the event unchanged if it is already v3.0 or nullish.
 */
export declare function upgradeEvent(event: Record<string, any>): StandardEvent;

export declare const SCHEMA_VERSION: "3.0";
export declare const FROZEN_FIELDS: ReadonlySet<string>;
