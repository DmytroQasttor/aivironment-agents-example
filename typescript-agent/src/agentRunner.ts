import { openai } from "./openai/openaiClient.js";
import { buildAgentPrompt } from "./agents/taskAgent";
import { mcpListTools, mcpCallTool } from "./mcp/mcpClientHttp";

export async function runAgent(task: any) {
  const history: any[] = [];
  let nextPrompt = buildAgentPrompt(task);

  while (true) {
    const promptParts = history.map((h) => ({
      role: h.role,
      content: h.content,
    }));

    promptParts.push({ role: "user", content: nextPrompt });

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL!,
      input: promptParts,
    });

    const text = response.output_text.trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error("Agent output not JSON");
    }

    if (parsed.action === "tool") {
      if (parsed.tool === "listTools") {
        const tools = await mcpListTools();
        history.push({
          role: "tool",
          content: JSON.stringify(tools),
        });
      } else {
        const toolResult = await mcpCallTool(parsed.tool, parsed.arguments);
        history.push({
          role: "tool",
          content: JSON.stringify(toolResult),
        });
      }
      nextPrompt = "";
      continue;
    }

    if (parsed.action === "final") {
      return parsed.result;
    }

    throw new Error("Unknown action");
  }
}
