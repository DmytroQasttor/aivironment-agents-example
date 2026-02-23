import { buildOutboundAuthHeaders } from "../auth/outboundAuth";
import { AgentError } from "../utils/agentError";

let nextId = 1;

interface JsonRpcError {
  code: number;
  message: string;
}

interface JsonRpcResponse<T = unknown> {
  result?: T;
  error?: JsonRpcError;
}

async function jsonRpcRequest(method: string, params: unknown, targetAgentDid?: string) {
  if (!process.env.MCP_HTTP_URL) {
    throw new AgentError("MCP_UNAVAILABLE", "MCP_HTTP_URL is not configured", true, 503);
  }

  const body = JSON.stringify({
    jsonrpc: "2.0",
    method,
    params,
    id: nextId++,
  });
  const mcpUrl = new URL(process.env.MCP_HTTP_URL);
  const authHeaders = await buildOutboundAuthHeaders({
    method: "POST",
    path: mcpUrl.pathname,
    body,
    targetAgentDid,
  });

  const response = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body,
  });

  if (!response.ok) {
    throw new AgentError(
      "MCP_UNAVAILABLE",
      `MCP HTTP ${response.status}: ${await response.text()}`,
      true,
      503,
    );
  }

  const json = (await response.json()) as JsonRpcResponse;
  if (json.error) {
    throw new AgentError(
      "MCP_TOOL_FAILED",
      `MCP error ${json.error.code}: ${json.error.message}`,
      true,
      502,
    );
  }
  if (typeof json.result === "undefined") {
    throw new AgentError("MCP_TOOL_FAILED", "MCP response missing result", true, 502);
  }
  return json.result;
}

export async function mcpCallTool(
  name: string,
  args: Record<string, unknown>,
  targetAgentDid?: string,
) {
  return jsonRpcRequest("tools/call", { name, args }, targetAgentDid);
}

export async function mcpGetTaskContext(taskId: string, correlationId: string) {
  return mcpCallTool("get_task_context", {
    task_id: taskId,
    correlation_id: correlationId,
  });
}

export async function mcpListReachableRoutes(intent: string) {
  return mcpCallTool("list_reachable_routes", { intent });
}

export async function mcpGetRouteDetails(connectionSlug: string, targetAgentDid: string) {
  return mcpCallTool("get_route_details", {
    connection_slug: connectionSlug,
    target_agent_did: targetAgentDid,
  });
}

export async function mcpDelegateTask(params: {
  connectionSlug: string;
  targetAgentDid: string;
  intent: string;
  payload: Record<string, unknown>;
  context: {
    correlation_id: string;
    parent_task_id: string;
    depth: number;
    max_depth: number;
    project_id: string | null;
  };
}) {
  return mcpCallTool(
    "delegate_task",
    {
      connection_slug: params.connectionSlug,
      target_agent_did: params.targetAgentDid,
      intent: params.intent,
      payload: params.payload,
      context: params.context,
    },
    params.targetAgentDid,
  );
}
