import { Agent, run } from "@openai/agents";
import { z } from "zod";
import { createGovernanceMcpServer } from "../openai/mcpServer";
import { getOpenAIMaxOutputTokens, getOpenAIModel } from "../openai/openaiClient";
import type { A2AForwardRequest, OpsCoordinatePayload, OpsCoordinateResult } from "../types/a2a";
import { AgentError } from "../utils/agentError";
import { validateOpsCoordinateInput, validateOpsCoordinateOutput } from "../validation/schemas";

const opsCoordinateOutputSchema = z.object({
  plan: z.string(),
  actions: z.array(
    z.object({
      action: z.string(),
      details: z.string().nullable(),
    }),
  ),
  score: z.number().nullable(),
});

function ensureValidOutput(result: unknown) {
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

function buildPrompt(request: A2AForwardRequest, payload: OpsCoordinatePayload) {
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
    "Each item in actions must be an object with required field `action` and nullable field `details`.",
  ].join("\n");
}

async function decideWithLlm(params: {
  request: A2AForwardRequest;
  payload: OpsCoordinatePayload;
}) {
  const mcpServer = createGovernanceMcpServer();
  await mcpServer.connect();

  try {
    const agent = new Agent({
      name: "Delivery Planning Coordinator",
      instructions: [
        "You are Delivery Planning Coordinator.",
        "You may use the connected governance MCP server to decide whether to delegate or complete locally.",
        "Prefer the smallest necessary set of tools and avoid exploratory tool calls unless they are required to complete the task safely.",
        "Use the route-first governance flow: aiv_get_task_lineage, aiv_list_routes, aiv_get_route_details, then aiv_delegate_task.",
        "Do not hardcode targets; discover routes via MCP tools and delegate only via active discovered route.",
        "Depth guardrail: only delegate when context.depth < context.max_depth.",
        "When the task asks for specialist deliverables such as compliance findings, audit evidence, risk review, or remediation recommendations, check specialist routes before finalizing a local answer.",
        "If a valid downstream specialist route exists for that specialist work, prefer delegating the specialist portion and then synthesizing the result rather than producing the full specialist output locally.",
        "If the task asks for compliance, audit, risk review, or recommendations and a valid downstream specialist route exists for that work, prefer delegating that specialized work instead of completing everything locally.",
        "Keep the work local only when no valid route exists, delegation depth is exhausted, or the downstream route does not allow the needed intent.",
      ].join("\n"),
      model: getOpenAIModel(),
      modelSettings: {
        maxTokens: getOpenAIMaxOutputTokens(),
      },
      mcpServers: [mcpServer],
      outputType: opsCoordinateOutputSchema,
    });

    const result = await run(agent, buildPrompt(params.request, params.payload));
    if (!result.finalOutput) {
      throw new AgentError("EXECUTION_FAILED", "LLM run returned no structured output", true, 502);
    }
    return result.finalOutput;
  } finally {
    await mcpServer.close();
  }
}

export async function runOpsCoordinate(request: A2AForwardRequest) {
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

  const result: OpsCoordinateResult = {
    plan: llmResult.plan,
    actions: llmResult.actions,
    ...(typeof llmResult.score === "number" ? { score: llmResult.score } : {}),
  };
  return ensureValidOutput(result);
}
