let nextId = 1;

async function jsonRpcRequest(method: string, params: any) {
  const body = {
    jsonrpc: "2.0",
    method,
    params,
    id: nextId++,
  };

  const r = await fetch(process.env.MCP_HTTP_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    throw new Error(`MCP HTTP ${r.status}: ${await r.text()}`);
  }
  return r.json();
}

export async function mcpListTools() {
  const res: any = await jsonRpcRequest("tools/list", {});
  return res.result;
}

export async function mcpCallTool(tool: string, args: any) {
  const res: any = await jsonRpcRequest("tools/call", {
    name: tool,
    args,
  });
  return res.result;
}
