import { buildOutboundAuthHeaders } from "../auth/outboundAuth.js";
import { AgentError } from "../utils/agentError.js";

let nextId = 1;

async function jsonRpcRequest(method, params, targetAgentDid) {
  if (!process.env.MCP_HTTP_URL) {
    throw new AgentError("MCP_UNAVAILABLE", "MCP_HTTP_URL is not configured", true, 503);
  }

  const mcpUrl = new URL(process.env.MCP_HTTP_URL);
  const body = JSON.stringify({
    jsonrpc: "2.0",
    method,
    params,
    id: nextId++,
  });

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

  const json = await response.json();
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

async function mcpCallTool(name, args, targetAgentDid) {
  return jsonRpcRequest("tools/call", { name, args }, targetAgentDid);
}

export async function mcpGetTaskContext(taskId, correlationId) {
  return mcpCallTool("get_task_context", {
    task_id: taskId,
    correlation_id: correlationId,
  });
}

export async function mcpListReachableRoutes(intent) {
  return mcpCallTool("list_reachable_routes", { intent });
}

export async function mcpGetRouteDetails(connectionSlug, targetAgentDid) {
  return mcpCallTool("get_route_details", {
    connection_slug: connectionSlug,
    target_agent_did: targetAgentDid,
  });
}

export async function mcpDelegateTask({
  connectionSlug,
  targetAgentDid,
  intent,
  payload,
  context,
}) {
  return mcpCallTool(
    "delegate_task",
    {
      connection_slug: connectionSlug,
      target_agent_did: targetAgentDid,
      intent,
      payload,
      context,
    },
    targetAgentDid,
  );
}
