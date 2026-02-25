import {
  getOpenAIClient,
  getOpenAIMaxOutputTokens,
  getOpenAIModel,
} from "../openai/openaiClient.js";
import {
  mcpCallTool,
} from "../mcp/mcpClientHttp.js";
import { AgentError } from "../utils/agentError.js";
import {
  validateOpsCoordinateInput,
  validateOpsCoordinateOutput,
} from "../validation/schemas.js";

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

const toolDefinitions = [
  {
    type: "function",
    name: "get_task_context",
    description: "Fetch context and lineage details for the current task id.",
    parameters: {
      type: "object",
      required: [],
      properties: {
        max_parent_depth: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "list_reachable_routes",
    description: "List active routes this agent can use for delegation from current task.",
    parameters: {
      type: "object",
      required: [],
      properties: {
        page: { type: "number" },
        per_page: { type: "number" },
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
      required: ["slug"],
      properties: {
        slug: { type: "string" },
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
        "connection",
        "target_agent_did",
        "intent",
        "payload",
      ],
      properties: {
        connection: { type: "string" },
        target_agent_did: { type: "string" },
        intent: { type: "string" },
        payload: { type: "object" },
        context: { type: "object" },
      },
      additionalProperties: false,
    },
  },
];

function parseJsonArgs(rawArgs) {
  if (!rawArgs || typeof rawArgs !== "string") {
    return {};
  }
  try {
    return JSON.parse(rawArgs);
  } catch {
    throw new AgentError("EXECUTION_FAILED", "Model produced invalid tool arguments", true, 502);
  }
}

async function runToolCall(call, requestTaskId) {
  const args = parseJsonArgs(call.arguments);
  switch (call.name) {
    case "get_task_context":
      return mcpCallTool(
        "get_task_context",
        {
          task_id: requestTaskId,
          ...(typeof args.max_parent_depth === "number"
            ? { max_parent_depth: args.max_parent_depth }
            : {}),
        },
      );
    case "list_reachable_routes":
      return mcpCallTool("list_reachable_routes", {
        task_id: requestTaskId,
        ...(typeof args.page === "number" ? { page: args.page } : {}),
        ...(typeof args.per_page === "number" ? { per_page: args.per_page } : {}),
      });
    case "get_route_details": {
      const slug =
        typeof args.slug === "string"
          ? args.slug
          : typeof args.connection_slug === "string"
            ? args.connection_slug
            : null;
      if (!slug) {
        throw new AgentError(
          "EXECUTION_FAILED",
          "Model must provide route slug for get_route_details",
          true,
          502,
        );
      }
      return mcpCallTool("get_route_details", {
        task_id: requestTaskId,
        slug,
      });
    }
    case "delegate_task": {
      const connection =
        typeof args.connection === "string"
          ? args.connection
          : typeof args.connection_slug === "string"
            ? args.connection_slug
            : null;
      const targetAgentDid = args.target_agent_did;
      if (!connection || typeof targetAgentDid !== "string") {
        throw new AgentError(
          "EXECUTION_FAILED",
          "Model must provide connection and target_agent_did for delegate_task",
          true,
          502,
        );
      }
      return mcpCallTool(
        "delegate_task",
        {
          task_id: requestTaskId,
          connection,
          target_agent: targetAgentDid,
          intent: args.intent,
          payload: args.payload,
          ...(args.context && typeof args.context === "object" ? { context: args.context } : {}),
        },
        targetAgentDid,
      );
    }
    default:
      throw new AgentError("EXECUTION_FAILED", `Unsupported tool requested: ${call.name}`, false, 400);
  }
}

async function decideWithLlm({ request, payload }) {
  const model = getOpenAIModel();
  const maxOutputTokens = getOpenAIMaxOutputTokens();
  const initialPrompt = [
    "You are Execution Task Coordinator.",
    "You may use MCP tools to decide whether to delegate or complete locally.",
    "Do not hardcode targets; discover routes via tools and delegate only via active discovered route.",
    "Depth guardrail: only delegate when context.depth < context.max_depth.",
    "When finished, respond with JSON object only:",
    "{ \"plan\": string, \"actions\": array, \"score\"?: number }",
    "",
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
  ].join("\n");

  const openai = getOpenAIClient();
  let response = await openai.responses.create({
    model,
    input: initialPrompt,
    tools: toolDefinitions,
    max_output_tokens: maxOutputTokens,
  });

  for (let i = 0; i < 12; i += 1) {
    const toolCalls = (response.output ?? []).filter(
      (item) => item.type === "function_call",
    );
    if (toolCalls.length === 0) {
      break;
    }

    const toolOutputs = [];
    for (const call of toolCalls) {
      const result = await runToolCall(call, request.task_id);
      toolOutputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }

    response = await openai.responses.create({
      model,
      previous_response_id: response.id,
      input: toolOutputs,
      tools: toolDefinitions,
      max_output_tokens: maxOutputTokens,
    });
  }

  try {
    return JSON.parse(response.output_text);
  } catch {
    throw new AgentError("EXECUTION_FAILED", "LLM final output was not valid JSON", true, 502);
  }
}

export async function runOpsCoordinate(request) {
  // 1) Strict input validation guards business logic from malformed payloads.
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
  const llmResult = await decideWithLlm({
    request,
    payload,
  });

  const result = {
    plan: llmResult.plan,
    actions: llmResult.actions,
    ...(typeof llmResult.score === "number" ? { score: llmResult.score } : {}),
  };
  
  return ensureValidOutput(result);
}
