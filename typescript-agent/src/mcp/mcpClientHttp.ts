import { AgentError } from "../utils/agentError";
import { buildMcpAuthorizationHeader } from "./mcpAuthHeader";

let nextId = 1;
let sessionId: string | null = null;
let initialized = false;

interface JsonRpcError {
  code: number;
  message: string;
}

interface JsonRpcResponse<T = unknown> {
  id?: number | string | null;
  result?: T;
  error?: JsonRpcError;
}

interface ToolAuthSpec {
  method: string;
  path: string;
  body: string;
  targetAgentDid?: string;
}

type ToolAuthResolver = (toolArgs: Record<string, unknown>) => ToolAuthSpec | null;

// MCP stream endpoint configured by deploy/dev environment.
function getMcpUrl() {
  if (!process.env.MCP_HTTP_URL) {
    throw new AgentError("MCP_UNAVAILABLE", "MCP_HTTP_URL is not configured", true, 503);
  }
  return new URL(process.env.MCP_HTTP_URL);
}

// Xano MCP stream responds as SSE frames; extract JSON-RPC payloads from `data:` lines.
function parseSseJsonResponses(text: string): JsonRpcResponse[] {
  const lines = text.split(/\r?\n/);
  const responses: JsonRpcResponse[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const payload = trimmed.slice("data:".length).trim();
    if (!payload) {
      continue;
    }
    try {
      const parsed = JSON.parse(payload) as JsonRpcResponse;
      responses.push(parsed);
    } catch {
      // Ignore non-JSON SSE frames.
    }
  }
  return responses;
}

// Prefer exact id match, then fallback to first frame carrying result/error.
function pickRpcResponse(responses: JsonRpcResponse[], requestId: number): JsonRpcResponse | null {
  for (const response of responses) {
    if (response.id === requestId) {
      return response;
    }
  }
  for (const response of responses) {
    if (typeof response.result !== "undefined" || response.error) {
      return response;
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }
  if (!isRecord(value)) {
    return value;
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeysDeep(value[key]);
  }
  return sorted;
}

// Canonical JSON serializer used for advanced-signature body hash parity.
function canonicalJson(value: unknown) {
  return JSON.stringify(sortKeysDeep(value));
}

const STATIC_TOOL_AUTH_SPECS: Record<string, ToolAuthSpec> = {
  list_reachable_routes: { method: "GET", path: "/api/v1/runtime/routes", body: "" },
  aiv_list_routes: { method: "GET", path: "/api/v1/runtime/routes", body: "" },
};

const DYNAMIC_TOOL_AUTH_SPECS: Record<string, ToolAuthResolver> = {
  get_route_details(toolArgs) {
    const slug = toolArgs.slug;
    if (typeof slug !== "string" || !slug) {
      return null;
    }
    return {
      method: "GET",
      path: `/api/v1/runtime/routes/${encodeURIComponent(slug)}`,
      body: "",
    };
  },
  aiv_get_route_details(toolArgs) {
    const slug = toolArgs.slug;
    if (typeof slug !== "string" || !slug) {
      return null;
    }
    return {
      method: "GET",
      path: `/api/v1/runtime/routes/${encodeURIComponent(slug)}`,
      body: "",
    };
  },
  get_task_context(toolArgs) {
    const taskId = toolArgs.task_id;
    if (typeof taskId !== "string" || !taskId) {
      return null;
    }
    return {
      method: "GET",
      path: `/api/v1/runtime/task-context/${encodeURIComponent(taskId)}`,
      body: "",
    };
  },
  aiv_get_task_lineage(toolArgs) {
    const taskId = toolArgs.task_id;
    if (typeof taskId !== "string" || !taskId) {
      return null;
    }
    return {
      method: "GET",
      path: `/api/v1/runtime/task-context/${encodeURIComponent(taskId)}`,
      body: "",
    };
  },
  delegate_task(toolArgs) {
    const targetAgent = toolArgs.target_agent;
    if (typeof targetAgent !== "string" || !targetAgent) {
      return null;
    }
    const canonicalBody: Record<string, unknown> = {
      target_agent: targetAgent,
      intent: toolArgs.intent,
      payload: toolArgs.payload,
      ...(isRecord(toolArgs.context)
        ? { context: toolArgs.context }
        : {}),
      connection: toolArgs.connection,
    };
    return {
      method: "POST",
      path: "/api/v1/a2a/send",
      body: canonicalJson(canonicalBody),
      targetAgentDid: targetAgent,
    };
  },
  aiv_delegate_task(toolArgs) {
    const targetAgent = toolArgs.target_agent;
    if (typeof targetAgent !== "string" || !targetAgent) {
      return null;
    }
    const canonicalBody: Record<string, unknown> = {
      target_agent: targetAgent,
      intent: toolArgs.intent,
      payload: toolArgs.payload,
      ...(isRecord(toolArgs.context)
        ? { context: toolArgs.context }
        : {}),
      connection: toolArgs.connection,
    };
    return {
      method: "POST",
      path: "/api/v1/a2a/send",
      body: canonicalJson(canonicalBody),
      targetAgentDid: targetAgent,
    };
  },
};

/**
 * Maps each MCP tool call to the platform auth canonical target:
 * method + path + body + optional target DID.
 * This is required for advanced auth signatures to match backend verification.
 */
function resolveToolAuthSpec(params: unknown): ToolAuthSpec | null {
  if (!isRecord(params)) {
    return null;
  }
  const name = params.name;
  const toolArgs = params.arguments;
  if (typeof name !== "string" || !isRecord(toolArgs)) {
    return null;
  }

  const staticSpec = STATIC_TOOL_AUTH_SPECS[name];
  if (staticSpec) {
    return staticSpec;
  }

  const dynamicSpecResolver = DYNAMIC_TOOL_AUTH_SPECS[name];
  if (dynamicSpecResolver) {
    return dynamicSpecResolver(toolArgs);
  }

  if (name.startsWith("aiv_")) {
    return {
      method: "POST",
      path: `mcp/${name}`,
      body: canonicalJson(toolArgs),
    };
  }

  return null;
}

// Sends one JSON-RPC call over MCP stream transport.
async function postRpc(method: string, params: unknown, targetAgentDid?: string) {
  const mcpUrl = getMcpUrl();
  const requestId = nextId++;

  const resolvedParams = params;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    method,
    params: resolvedParams,
    id: requestId,
  });

  const authSpec =
    method === "tools/call" ? resolveToolAuthSpec(params) : null;
  const authorizationHeader = await buildMcpAuthorizationHeader(
    authSpec ?? {
      method: "POST",
      path: mcpUrl.pathname,
      body,
      targetAgentDid,
    },
  );

  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    Authorization: authorizationHeader,
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }

  const response = await fetch(mcpUrl, {
    method: "POST",
    headers,
    body,
  });

  const responseText = await response.text();
  const responseSessionId = response.headers.get("mcp-session-id");
  if (responseSessionId) {
    sessionId = responseSessionId;
  }

  if (!response.ok) {
    throw new AgentError(
      "MCP_UNAVAILABLE",
      `MCP HTTP ${response.status}: ${responseText}`,
      true,
      503,
    );
  }

  const rpcResponses = parseSseJsonResponses(responseText);
  const rpcResponse = pickRpcResponse(rpcResponses, requestId);
  if (!rpcResponse) {
    throw new AgentError("MCP_TOOL_FAILED", "MCP stream response missing JSON-RPC frame", true, 502);
  }
  if (rpcResponse.error) {
    throw new AgentError(
      "MCP_TOOL_FAILED",
      `MCP error ${rpcResponse.error.code}: ${rpcResponse.error.message}`,
      true,
      502,
    );
  }
  return rpcResponse.result;
}

// Initializes MCP session once per process.
async function ensureInitialized() {
  if (initialized) {
    return;
  }

  const initResult = await postRpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "aivironment-typescript-agent",
      version: "1.0.0",
    },
  });

  if (!initResult || typeof initResult !== "object") {
    throw new AgentError("MCP_UNAVAILABLE", "MCP initialize returned invalid result", true, 503);
  }

  initialized = true;
}

// Generic tool invoker used by intent logic.
export async function mcpCallTool(
  name: string,
  args: Record<string, unknown>,
  targetAgentDid?: string,
) {
  await ensureInitialized();
  const result = await postRpc("tools/call", { name, arguments: args }, targetAgentDid);
  if (typeof result === "undefined") {
    throw new AgentError("MCP_TOOL_FAILED", "MCP response missing result", true, 502);
  }
  return result;
}

// Convenience wrappers used by examples/tests and documentation readability.
export async function mcpGetTaskContext(taskId: string, correlationId: string) {
  return mcpCallTool("aiv_get_task_lineage", {
    task_id: taskId,
    correlation_id: correlationId,
  });
}

export async function mcpListReachableRoutes(taskId: string) {
  return mcpCallTool("aiv_list_routes", { task_id: taskId });
}

export async function mcpGetRouteDetails(taskId: string, slug: string) {
  return mcpCallTool("aiv_get_route_details", {
    task_id: taskId,
    slug,
  });
}

export async function mcpDelegateTask(params: {
  taskId: string;
  connection: string;
  targetAgentDid: string;
  intent: string;
  payload: Record<string, unknown>;
  context: Record<string, unknown>;
}) {
  return mcpCallTool(
    "aiv_delegate_task",
    {
      task_id: params.taskId,
      connection: params.connection,
      target_agent: params.targetAgentDid,
      intent: params.intent,
      payload: params.payload,
      context: params.context,
    },
    params.targetAgentDid,
  );
}
