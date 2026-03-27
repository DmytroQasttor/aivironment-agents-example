import { MCPServerStreamableHttp } from "@openai/agents";
import { createGovernanceMcpFetch } from "../mcp/mcpTransportAuth.js";
import { AgentError } from "../utils/agentError.js";

function requireMcpHttpUrl() {
  const value = process.env.MCP_HTTP_URL;
  if (!value) {
    throw new AgentError("CONFIG_INVALID", "MCP_HTTP_URL is required for native MCP access", false, 500);
  }
  return value;
}

export function createGovernanceMcpServer() {
  return new MCPServerStreamableHttp({
    name: process.env.MCP_SERVER_LABEL ?? "aiv_governance_mcp",
    url: requireMcpHttpUrl(),
    fetch: createGovernanceMcpFetch(),
  });
}
