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

async function postRpc(method: string, params: unknown, targetAgentDid?: string) {
  const mcpUrl = getMcpUrl();
  const requestId = nextId++;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    method,
    params,
    id: requestId,
  });
  const authHeaders = await buildOutboundAuthHeaders({
    method: "POST",
    path: mcpUrl.pathname,
    body,
    targetAgentDid,
  });

  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    ...authHeaders,
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
  const result = await postRpc("tools/call", { name, args }, targetAgentDid);
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
