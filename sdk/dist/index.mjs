// src/index.ts
var BrainError = class extends Error {
  constructor(message, status) {
    super(message);
    this.name = "BrainError";
    this.status = status;
  }
};
var Brain = class {
  constructor(config) {
    if (!config.apiKey) throw new Error("apiKey is required");
    this.apiKey = config.apiKey;
    if (!config.baseUrl) throw new Error("baseUrl is required");
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.timeout = config.timeout || 3e4;
  }
  /**
   * Execute an event through the AI pipeline.
   * Returns the AI decision (execute/ignore/notify/defer).
   *
   * @example
   * const result = await brain.run('github', 'push', { repo: 'my/repo', branch: 'main' });
   * console.log(result.decision.action); // 'execute'
   */
  async run(source, type, payload, model) {
    return this.request("/v1/execute", {
      method: "POST",
      body: JSON.stringify({ source, type, payload, model })
    });
  }
  /**
   * Get current usage statistics.
   */
  async usage() {
    return this.request("/v1/usage");
  }
  /**
   * List active learned rules with optional filters.
   */
  async rules(filters) {
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.source) params.set("source", filters.source);
    const qs = params.toString();
    return this.request(`/v1/rules${qs ? `?${qs}` : ""}`);
  }
  /**
   * List connectors.
   */
  async connectors() {
    return this.request("/v1/connectors");
  }
  /**
   * Dispatch a task to an edge agent.
   */
  async dispatch(agentId, taskType, payload) {
    return this.request("/v1/edge/dispatch", {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId, task_type: taskType, payload })
    });
  }
  /**
   * Query events with optional filters.
   */
  async events(filters) {
    const params = new URLSearchParams();
    if (filters?.source) params.set("source", filters.source);
    if (filters?.type) params.set("type", filters.type);
    if (filters?.limit !== void 0) params.set("limit", String(filters.limit));
    if (filters?.offset !== void 0) params.set("offset", String(filters.offset));
    const qs = params.toString();
    return this.request(`/v1/events${qs ? `?${qs}` : ""}`);
  }
  /**
   * Subscribe to real-time events via SSE.
   * Returns a handle with close() to abort the connection.
   */
  stream(callback) {
    const controller = new AbortController();
    const connect = async () => {
      try {
        const res = await fetch(`${this.baseUrl}/v1/events/stream`, {
          headers: {
            "Accept": "text/event-stream",
            "x-api-key": this.apiKey
          },
          signal: controller.signal
        });
        if (!res.ok || !res.body) {
          throw new BrainError(`SSE connection failed: HTTP ${res.status}`, res.status);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          let eventType = "message";
          let dataLines = [];
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trim());
            } else if (line === "") {
              if (dataLines.length > 0) {
                const raw = dataLines.join("\n");
                let data;
                try {
                  data = JSON.parse(raw);
                } catch {
                  data = raw;
                }
                callback({ type: eventType, data });
              }
              eventType = "message";
              dataLines = [];
            }
          }
        }
      } catch (e) {
        if (e.name === "AbortError") return;
        throw e;
      }
    };
    connect().catch(() => {
    });
    return { close: () => controller.abort() };
  }
  async request(path, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...opts,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          ...opts.headers
        }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new BrainError(
          data.error || `HTTP ${res.status}`,
          res.status
        );
      }
      return data;
    } catch (e) {
      if (e.name === "AbortError") {
        throw new BrainError("Request timeout", 408);
      }
      if (e instanceof BrainError) throw e;
      throw new BrainError(e.message, 0);
    } finally {
      clearTimeout(timer);
    }
  }
};
var index_default = Brain;
export {
  Brain,
  BrainError,
  index_default as default
};
