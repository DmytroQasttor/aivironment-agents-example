import { buildOutboundAuthHeaders } from "../auth/outboundAuth.js";
import { AgentError } from "../utils/agentError.js";

let nextId = 1;
let sessionId = null;
let initialized = false;

function getMcpUrl() {
  if (!process.env.MCP_HTTP_URL) {
    throw new AgentError("MCP_UNAVAILABLE", "MCP_HTTP_URL is not configured", true, 503);
  }
  return new URL(process.env.MCP_HTTP_URL);
}

function parseSseJsonResponses(text) {
  const responses = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const payload = trimmed.slice("data:".length).trim();
    if (!payload) {
      continue;
    }
    try {
      responses.push(JSON.parse(payload));
    } catch {
      // Ignore non-JSON frames.
    }
  }
  return responses;
}

function pickRpcResponse(responses, requestId) {
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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item));
  }
  if (!isRecord(value)) {
    return value;
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortKeysDeep(value[key]);
  }
  return sorted;
}

function canonicalJson(value) {
  return JSON.stringify(sortKeysDeep(value));
}

function resolveToolAuthSpec(params) {
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
    if (typeof toolArgs.slug !== "string" || !toolArgs.slug) {
      return null;
    }
    return {
      method: "GET",
      path: `/api/v1/runtime/routes/${encodeURIComponent(toolArgs.slug)}`,
      body: "",
    };
  }
  if (name === "get_task_context") {
    if (typeof toolArgs.task_id !== "string" || !toolArgs.task_id) {
      return null;
    }
    return {
      method: "GET",
      path: `/api/v1/runtime/task-context/${encodeURIComponent(toolArgs.task_id)}`,
      body: "",
    };
  }
  if (name === "delegate_task") {
    if (typeof toolArgs.target_agent !== "string" || !toolArgs.target_agent) {
      return null;
    }
    const canonicalBody = {
      target_agent: toolArgs.target_agent,
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
      targetAgentDid: toolArgs.target_agent,
    };
  }
  return null;
}

async function withToolAuthArguments(params) {
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

async function postRpc(method, params, targetAgentDid) {
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

  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    ...transportAuthHeaders,
    ...(sessionId ? { "mcp-session-id": sessionId } : {}),
  };

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
      name: "aivironment-javascript-agent",
      version: "1.0.0",
    },
  });

  if (!initResult || typeof initResult !== "object") {
    throw new AgentError("MCP_UNAVAILABLE", "MCP initialize returned invalid result", true, 503);
  }
  initialized = true;
}

export async function mcpCallTool(name, args, targetAgentDid) {
  await ensureInitialized();
  const result = await postRpc("tools/call", { name, arguments: args }, targetAgentDid);
  if (typeof result === "undefined") {
    throw new AgentError("MCP_TOOL_FAILED", "MCP response missing result", true, 502);
  }
  return result;
}

export async function mcpGetTaskContext(taskId, correlationId) {
  return mcpCallTool("get_task_context", {
    task_id: taskId,
    correlation_id: correlationId,
  });
}

export async function mcpListReachableRoutes(taskId) {
  return mcpCallTool("list_reachable_routes", { task_id: taskId });
}

export async function mcpGetRouteDetails(taskId, slug) {
  return mcpCallTool("get_route_details", { task_id: taskId, slug });
}

export async function mcpDelegateTask({
  taskId,
  connection,
  targetAgentDid,
  intent,
  payload,
  context,
}) {
  return mcpCallTool(
    "delegate_task",
    {
      task_id: taskId,
      connection,
      target_agent: targetAgentDid,
      intent,
      payload,
      ...(context ? { context } : {}),
    },
    targetAgentDid,
  );
}
