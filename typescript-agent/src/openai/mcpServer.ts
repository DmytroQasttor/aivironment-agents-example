import { MCPServerStreamableHttp } from "@openai/agents";
import { createGovernanceMcpFetch } from "../mcp/mcpTransportAuth";
import { AgentError } from "../utils/agentError";

function requireMcpHttpUrl() {
  const url = process.env.MCP_HTTP_URL;
  if (!url) {
    throw new AgentError("CONFIG_INVALID", "MCP_HTTP_URL is required for native MCP access", false, 500);
  }
  return url;
}

export function createGovernanceMcpServer() {
  return new MCPServerStreamableHttp({
    name: process.env.MCP_SERVER_LABEL ?? "aiv_governance_mcp",
    url: requireMcpHttpUrl(),
    fetch: createGovernanceMcpFetch(),
  });
}
