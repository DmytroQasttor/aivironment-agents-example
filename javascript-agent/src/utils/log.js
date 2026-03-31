export function logInfo(message, fields = {}) {
  console.log(
    JSON.stringify({
      level: "info",
      message,
      ...fields,
      ts: new Date().toISOString(),
    }),
  );
}

export function logError(message, fields = {}) {
  console.error(
    JSON.stringify({
      level: "error",
      message,
      ...fields,
      ts: new Date().toISOString(),
    }),
  );
}

// MCP debug logging — enable with MCP_DEBUG=1 or MCP_DEBUG=true.
// Logs raw tool call details, session lifecycle, and auth envelope metadata.
export function logMcpDebug(message, data) {
  if (process.env.MCP_DEBUG !== "1" && process.env.MCP_DEBUG !== "true") {
    return;
  }
  if (data) {
    console.log("[mcp-debug]", message, JSON.stringify(data));
    return;
  }
  console.log("[mcp-debug]", message);
}
