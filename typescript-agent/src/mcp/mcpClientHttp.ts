import { buildOutboundAuthHeaders } from "../auth/outboundAuth";
import { AgentError } from "../utils/agentError";

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

function getMcpUrl() {
  if (!process.env.MCP_HTTP_URL) {
    throw new AgentError("MCP_UNAVAILABLE", "MCP_HTTP_URL is not configured", true, 503);
  }
  return new URL(process.env.MCP_HTTP_URL);
}

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

function hasKeys(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length > 0;
}

function resolveToolAuthSpec(params: unknown): ToolAuthSpec | null {
  if (!isRecord(params)) {
    return null;
  }
  const name = params.name;
  const toolArgs = params.arguments;
  if (typeof name !== "string" || !isRecord(toolArgs)) {
    return null;
  }

  if (name === "list_reachable_routes") {
    return { method: "GET", path: "/api/v1/runtime/routes", body: "" };
  }
  if (name === "get_route_details") {
    const slug = toolArgs.slug;
    if (typeof slug !== "string" || !slug) {
      return null;
    }
    return {
      method: "GET",
      path: `/api/v1/runtime/routes/${encodeURIComponent(slug)}`,
      body: "",
    };
  }
  if (name === "get_task_context") {
    const taskId = toolArgs.task_id;
    if (typeof taskId !== "string" || !taskId) {
      return null;
    }
    return {
      method: "GET",
      path: `/api/v1/runtime/task-context/${encodeURIComponent(taskId)}`,
      body: "",
    };
  }
  if (name === "delegate_task") {
    const targetAgent = toolArgs.target_agent;
    if (typeof targetAgent !== "string" || !targetAgent) {
      return null;
    }
    const canonicalBody: Record<string, unknown> = {
      target_agent: targetAgent,
      intent: toolArgs.intent,
      payload: toolArgs.payload,
      ...(hasKeys(toolArgs.context)
        ? { context: toolArgs.context }
        : {}),
      connection: toolArgs.connection,
    };
    return {
      method: "POST",
      path: "/api/v1/a2a/send",
      body: JSON.stringify(canonicalBody),
      targetAgentDid: targetAgent,
    };
  }

  return null;
}

async function withToolAuthArguments(params: unknown): Promise<unknown> {
  if (!isRecord(params) || !isRecord(params.arguments)) {
    return params;
  }
  const spec = resolveToolAuthSpec(params);
  if (!spec) {
    return params;
  }

  const authHeaders = await buildOutboundAuthHeaders({
    method: spec.method,
    path: spec.path,
    body: spec.body,
    targetAgentDid: spec.targetAgentDid,
  });

  return {
    ...params,
    arguments: {
      ...params.arguments,
      ...(typeof authHeaders.Authorization === "string"
        ? { authorization_header: authHeaders.Authorization }
        : {}),
      ...(typeof authHeaders["X-Agent-ID"] === "string"
        ? { agent_id_header: authHeaders["X-Agent-ID"] }
        : {}),
      ...(typeof authHeaders["X-Timestamp"] === "string"
        ? { timestamp_header: authHeaders["X-Timestamp"] }
        : {}),
      ...(typeof authHeaders["X-Signature"] === "string"
        ? { signature_header: authHeaders["X-Signature"] }
        : {}),
      ...(typeof authHeaders["X-Signature-Algorithm"] === "string"
        ? { algorithm_header: authHeaders["X-Signature-Algorithm"] }
        : {}),
    },
  };
}

async function postRpc(method: string, params: unknown, targetAgentDid?: string) {
  const mcpUrl = getMcpUrl();
  const requestId = nextId++;

  const resolvedParams =
    method === "tools/call" ? await withToolAuthArguments(params) : params;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    method,
    params: resolvedParams,
    id: requestId,
  });

  const transportAuthHeaders = await buildOutboundAuthHeaders({
    method: "POST",
    path: mcpUrl.pathname,
    body,
    targetAgentDid,
  });

  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    ...transportAuthHeaders,
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

export async function mcpGetTaskContext(taskId: string, correlationId: string) {
  return mcpCallTool("get_task_context", {
    task_id: taskId,
    correlation_id: correlationId,
  });
}

export async function mcpListReachableRoutes(taskId: string) {
  return mcpCallTool("list_reachable_routes", { task_id: taskId });
}

export async function mcpGetRouteDetails(taskId: string, slug: string) {
  return mcpCallTool("get_route_details", {
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
    "delegate_task",
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
