export function buildAgentPrompt(task: any) {
  return `
You are an AI agent with access to MCP tools via HTTP RPC.

When you want to call a tool, output JSON like:
{ "action": "tool", "tool": "<name>", "arguments": {...} }

When you are done, output:
{ "action": "final", "result": {...} }

Here is the task:
${JSON.stringify(task)}
  `.trim();
}
