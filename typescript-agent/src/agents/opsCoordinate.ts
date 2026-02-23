import type { A2AForwardRequest, OpsCoordinatePayload, OpsCoordinateResult } from "../types/a2a";
import { mcpCallTool } from "../mcp/mcpClientHttp";
import { AgentError } from "../utils/agentError";
import { validateOpsCoordinateInput, validateOpsCoordinateOutput } from "../validation/schemas";
import { getOpenAIModel, openai } from "../openai/openaiClient";

const toolDefinitions = [
  {
    type: "function",
    name: "get_task_context",
    description: "Fetch context and lineage details for the current task.",
    parameters: {
      type: "object",
      required: ["task_id", "correlation_id"],
      properties: {
        task_id: { type: "string" },
        correlation_id: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "list_reachable_routes",
    description: "List active routes this agent can use for delegation.",
    parameters: {
      type: "object",
      required: ["intent"],
      properties: {
        intent: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_route_details",
    description: "Get details and schema expectations for a selected route.",
    parameters: {
      type: "object",
      required: ["connection_slug", "target_agent_did"],
      properties: {
        connection_slug: { type: "string" },
        target_agent_did: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "delegate_task",
    description:
      "Delegate to a target agent. Use only with discovered active routes and correct lineage context.",
    parameters: {
      type: "object",
      required: [
        "connection_slug",
        "target_agent_did",
        "intent",
        "payload",
        "context",
      ],
      properties: {
        connection_slug: { type: "string" },
        target_agent_did: { type: "string" },
        intent: { type: "string" },
        payload: { type: "object" },
        context: { type: "object" },
      },
      additionalProperties: false,
    },
  },
];

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

function parseJsonArgs(rawArgs: unknown) {
  if (!rawArgs || typeof rawArgs !== "string") {
    return {} as Record<string, unknown>;
  }
  try {
    return JSON.parse(rawArgs) as Record<string, unknown>;
  } catch {
    throw new AgentError("EXECUTION_FAILED", "Model produced invalid tool arguments", true, 502);
  }
}

async function runToolCall(call: any) {
  const args = parseJsonArgs(call.arguments);
  switch (call.name) {
    case "get_task_context":
    case "list_reachable_routes":
    case "get_route_details":
    case "delegate_task":
      return mcpCallTool(call.name, args, args.target_agent_did as string | undefined);
    default:
      throw new AgentError(
        "EXECUTION_FAILED",
        `Unsupported tool requested: ${call.name}`,
        false,
        400,
      );
  }
}

async function decideWithLlm(params: {
  request: A2AForwardRequest;
  payload: OpsCoordinatePayload;
}) {
  const model = getOpenAIModel();
  const initialPrompt = [
    "You are Delivery Planning Coordinator.",
    "You may use MCP tools to decide whether to delegate or complete locally.",
    "Do not hardcode targets; discover routes via tools and delegate only via active discovered route.",
    "Depth guardrail: only delegate when context.depth < context.max_depth.",
    "When finished, respond with JSON object only:",
    '{ "plan": string, "actions": array, "score"?: number }',
    "",
    JSON.stringify(
      {
        task_id: params.request.task_id,
        intent: params.request.intent,
        payload: params.payload,
        context: params.request.context,
      },
      null,
      2,
    ),
  ].join("\n");

  let response: any = await openai.responses.create({
    model,
    input: initialPrompt,
    tools: toolDefinitions as any,
  });

  for (let i = 0; i < 12; i += 1) {
    const outputItems = Array.isArray(response.output) ? response.output : [];
    const toolCalls = outputItems.filter((item: any) => item.type === "function_call");
    if (toolCalls.length === 0) {
      break;
    }

    const toolOutputs = [];
    for (const call of toolCalls) {
      const result = await runToolCall(call);
      toolOutputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }

    response = await openai.responses.create({
      model,
      previous_response_id: response.id,
      input: toolOutputs as any,
      tools: toolDefinitions as any,
    });
  }

  try {
    return JSON.parse(response.output_text);
  } catch {
    throw new AgentError("EXECUTION_FAILED", "LLM final output was not valid JSON", true, 502);
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
