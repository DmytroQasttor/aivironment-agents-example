import { Agent, run } from "@openai/agents";
import { z } from "zod";
import { createGovernanceMcpServer } from "../openai/mcpServer.js";
import { getOpenAIMaxOutputTokens, getOpenAIModel } from "../openai/openaiClient.js";
import { AgentError } from "../utils/agentError.js";
import {
  validateOpsCoordinateInput,
  validateOpsCoordinateOutput,
} from "../validation/schemas.js";

const opsCoordinateOutputSchema = z.object({
  plan: z.string(),
  actions: z.array(z.record(z.string(), z.unknown())),
  score: z.number().optional(),
});

function ensureValidOutput(result) {
  const outputValidation = validateOpsCoordinateOutput(result);
  if (!outputValidation.ok) {
    throw new AgentError(
      "OUTPUT_INVALID",
      `Result failed schema validation: ${outputValidation.errors.join("; ")}`,
      false,
      500,
    );
  }
  return outputValidation.value;
}

function buildPrompt(request, payload) {
  return [
    "Current task context:",
    JSON.stringify(
      {
        task_id: request.task_id,
        intent: request.intent,
        payload,
        context: request.context,
      },
      null,
      2,
    ),
    "",
    "Return only the structured output requested by the schema.",
  ].join("\n");
}

async function decideWithLlm({ request, payload }) {
  const mcpServer = createGovernanceMcpServer();
  await mcpServer.connect();

  try {
    const agent = new Agent({
      name: "Execution Task Coordinator",
      instructions: [
        "You are Execution Task Coordinator.",
        "You may use the connected governance MCP server to decide whether to delegate or complete locally.",
        "Prefer the smallest necessary set of tools and avoid exploratory tool calls unless they are required to complete the task safely.",
        "Use the route-first governance flow: aiv_get_task_lineage, aiv_list_routes, aiv_get_route_details, then aiv_delegate_task.",
        "Do not hardcode targets; discover routes via MCP tools and delegate only via active discovered route.",
        "Depth guardrail: only delegate when context.depth < context.max_depth.",
      ].join("\n"),
      model: getOpenAIModel(),
      modelSettings: {
        maxTokens: getOpenAIMaxOutputTokens(),
      },
      mcpServers: [mcpServer],
      outputType: opsCoordinateOutputSchema,
    });

    const result = await run(agent, buildPrompt(request, payload));
    if (!result.finalOutput) {
      throw new AgentError("EXECUTION_FAILED", "LLM run returned no structured output", true, 502);
    }
    return result.finalOutput;
  } finally {
    await mcpServer.close();
  }
}

export async function runOpsCoordinate(request) {
  const inputValidation = validateOpsCoordinateInput(request.payload);
  if (!inputValidation.ok) {
    throw new AgentError(
      "PAYLOAD_INVALID",
      `Payload failed schema validation: ${inputValidation.errors.join("; ")}`,
      false,
      400,
    );
  }

  const payload = inputValidation.value;
  const llmResult = await decideWithLlm({ request, payload });

  const result = {
    plan: llmResult.plan,
    actions: llmResult.actions,
    ...(typeof llmResult.score === "number" ? { score: llmResult.score } : {}),
  };
  return ensureValidOutput(result);
}
