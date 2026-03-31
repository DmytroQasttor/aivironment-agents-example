import { Agent, run } from "@openai/agents";
import { z } from "zod";
import { createGovernanceMcpServer } from "../openai/mcpServer.js";
import { getOpenAIMaxOutputTokens, getOpenAIModel } from "../openai/openaiClient.js";
import { AgentError } from "../utils/agentError.js";
import { logMcpDebug } from "../utils/log.js";
import { validateOpsCoordinateInput } from "../validation/schemas.js";

// Output schema enforced by the OpenAI Agents SDK structured output feature.
// The SDK guarantees the LLM produces a valid object matching this shape,
// so no additional AJV re-validation is needed after the run completes.
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
    "Each item in actions must be an object with required field `action` and nullable field `details`.",
  ].join("\n");
}

async function decideWithLlm({ request, payload }) {
  const mcpServer = createGovernanceMcpServer();
  logMcpDebug("connecting mcp server");
  await mcpServer.connect();
  logMcpDebug("mcp server connected");

  try {
    const agent = new Agent({
      name: "Execution Task Coordinator",
      // Agent 02 in the chain: converts high-level plans into execution steps and
      // routes compliance/risk work downstream to a specialist agent (ops.audit).
      // Unlike Agent 01 (planning focus), this agent's primary job is orchestration:
      // detect compliance requirements in the objective and delegate them rather than
      // resolving them locally.
      instructions: [
        "You are Execution Task Coordinator.",
        "Your primary role is orchestration: break down high-level plans into execution steps and route specialist work to downstream agents.",
        "Use the route-first governance flow: aiv_get_task_lineage, aiv_list_routes, aiv_get_route_details, then aiv_delegate_task.",
        "Do not hardcode targets; discover routes via MCP tools and delegate only via active discovered route.",
        "Depth guardrail: only delegate when context.depth < context.max_depth.",
        "When the objective contains compliance requirements, risk assessments, or audit needs, actively look for a downstream specialist route (e.g. ops.audit) and delegate that work rather than completing it locally.",
        "Prefer delegating compliance and risk work to a specialist agent over producing generic findings yourself.",
        "Complete locally only when no valid specialist route exists, delegation depth is exhausted, or the task is purely execution-focused with no compliance angle.",
      ].join("\n"),
      model: getOpenAIModel(),
      modelSettings: {
        maxTokens: getOpenAIMaxOutputTokens(),
      },
      mcpServers: [mcpServer],
      outputType: opsCoordinateOutputSchema,
    });

    logMcpDebug("starting agent run", {
      task_id: request.task_id,
      intent: request.intent,
    });
    const result = await run(agent, buildPrompt(request, payload));
    logMcpDebug("agent run finished", {
      has_final_output: !!result.finalOutput,
    });
    if (!result.finalOutput) {
      throw new AgentError("EXECUTION_FAILED", "LLM run returned no structured output", true, 502);
    }
    return result.finalOutput;
  } catch (error) {
    logMcpDebug("agent run failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await mcpServer.close();
    logMcpDebug("mcp server closed");
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

  // llmResult is already validated by the SDK's outputType schema above.
  // Return it directly — no additional schema re-check needed.
  return {
    plan: llmResult.plan,
    actions: llmResult.actions,
    ...(typeof llmResult.score === "number" ? { score: llmResult.score } : {}),
  };
}
