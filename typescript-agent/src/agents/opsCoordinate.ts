import type { A2AForwardRequest, OpsCoordinatePayload, OpsCoordinateResult } from "../types/a2a";
import { mcpCallTool } from "../mcp/mcpClientHttp";
import { AgentError } from "../utils/agentError";
import { validateOpsCoordinateInput, validateOpsCoordinateOutput } from "../validation/schemas";
import { getOpenAIMaxOutputTokens, getOpenAIModel, openai } from "../openai/openaiClient";

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function parsePossibleJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function unwrapMcpResult(result: unknown): unknown {
  if (!isPlainObject(result)) {
    return result;
  }
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0) {
    return result;
  }
  const first = content[0];
  if (!isPlainObject(first) || typeof first.text !== "string") {
    return result;
  }
  return parsePossibleJson(first.text);
}

function extractConnectionId(routeDetailsRaw: unknown): string | null {
  const routeDetails = unwrapMcpResult(routeDetailsRaw);
  if (!isPlainObject(routeDetails)) {
    return null;
  }
  const topCandidates = [
    routeDetails.connection,
    routeDetails.connection_id,
    routeDetails.id,
  ];
  for (const candidate of topCandidates) {
    if (typeof candidate === "string" && isUuid(candidate)) {
      return candidate;
    }
  }
  if (isPlainObject(routeDetails.route)) {
    const nested = [
      routeDetails.route.connection,
      routeDetails.route.connection_id,
      routeDetails.route.id,
    ];
    for (const candidate of nested) {
      if (typeof candidate === "string" && isUuid(candidate)) {
        return candidate;
      }
    }
  }
  if (isPlainObject(routeDetails.payload)) {
    const payloadCandidates = [
      routeDetails.payload.connection,
      routeDetails.payload.connection_id,
      routeDetails.payload.id,
    ];
    for (const candidate of payloadCandidates) {
      if (typeof candidate === "string" && isUuid(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function extractTargetDid(routeDetailsRaw: unknown): string | null {
  const routeDetails = unwrapMcpResult(routeDetailsRaw);
  if (!isPlainObject(routeDetails)) {
    return null;
  }
  const candidates = [
    routeDetails.target_agent_did,
    isPlainObject(routeDetails.route) ? routeDetails.route.target_agent_did : undefined,
    isPlainObject(routeDetails.payload) ? routeDetails.payload.target_agent_did : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

function extractIntentInputSchema(routeDetailsRaw: unknown, intent: string): Record<string, unknown> | null {
  const routeDetails = unwrapMcpResult(routeDetailsRaw);
  if (!isPlainObject(routeDetails)) {
    return null;
  }

  const schemaCandidates: unknown[] = [];
  if (isPlainObject(routeDetails.input_schema)) {
    schemaCandidates.push(routeDetails.input_schema);
  }
  if (isPlainObject(routeDetails.intent_input_schema)) {
    schemaCandidates.push(routeDetails.intent_input_schema);
  }
  if (isPlainObject(routeDetails.schema) && isPlainObject(routeDetails.schema.input_schema)) {
    schemaCandidates.push(routeDetails.schema.input_schema);
  }

  const intentsContainers: unknown[] = [];
  if (Array.isArray(routeDetails.intents)) {
    intentsContainers.push(routeDetails.intents);
  }
  if (isPlainObject(routeDetails.payload) && Array.isArray(routeDetails.payload.intents)) {
    intentsContainers.push(routeDetails.payload.intents);
  }
  for (const container of intentsContainers) {
    if (!Array.isArray(container)) {
      continue;
    }
    const match = container.find(
      (item) =>
        isPlainObject(item) &&
        ((typeof item.intent === "string" && item.intent === intent) ||
          (typeof item.name === "string" && item.name === intent)),
    );
    if (isPlainObject(match)) {
      if (isPlainObject(match.input_schema)) {
        schemaCandidates.push(match.input_schema);
      }
      if (isPlainObject(match.schema) && isPlainObject(match.schema.input_schema)) {
        schemaCandidates.push(match.schema.input_schema);
      }
    }
  }

  for (const candidate of schemaCandidates) {
    if (isPlainObject(candidate)) {
      return candidate;
    }
  }
  return null;
}

function normalizePayloadBySchema(
  payload: Record<string, unknown>,
  inputSchema: Record<string, unknown> | null,
) {
  if (!inputSchema || !isPlainObject(inputSchema.properties)) {
    return payload;
  }
  const preferred = Object.keys(inputSchema.properties);
  const normalized: Record<string, unknown> = {};
  for (const key of preferred) {
    if (key in payload) {
      normalized[key] = payload[key];
    }
  }
  for (const [key, value] of Object.entries(payload)) {
    if (!(key in normalized)) {
      normalized[key] = value;
    }
  }
  return normalized;
}

async function runToolCall(call: any, requestTaskId: string) {
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
      let targetAgentDid = args.target_agent_did;
      if (!connection || typeof targetAgentDid !== "string") {
        throw new AgentError(
          "EXECUTION_FAILED",
          "Model must provide connection and target_agent_did for delegate_task",
          true,
          502,
        );
      }
      let routeDetails: unknown = null;
      let resolvedConnection = connection;
      if (!isUuid(connection)) {
        routeDetails = await mcpCallTool("get_route_details", {
          task_id: requestTaskId,
          slug: connection,
        });
        resolvedConnection = extractConnectionId(routeDetails) ?? connection;
        targetAgentDid = extractTargetDid(routeDetails) ?? targetAgentDid;
      }
      if (!isPlainObject(args.payload)) {
        if (!routeDetails && !isUuid(connection)) {
          routeDetails = await mcpCallTool("get_route_details", {
            task_id: requestTaskId,
            slug: connection,
          });
        }
        return {
          error: {
            code: "TOOL_ARGUMENTS_INVALID",
            message:
              "delegate_task requires payload as a JSON object matching selected route intent schema",
          },
          route_details: routeDetails,
        };
      }
      return mcpCallTool(
        "delegate_task",
        {
          task_id: requestTaskId,
          connection: resolvedConnection,
          target_agent: targetAgentDid,
          intent: args.intent,
          payload: args.payload,
          ...(isPlainObject(args.context) ? { context: args.context } : {}),
        },
        targetAgentDid,
      );
    }
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
  const maxOutputTokens = getOpenAIMaxOutputTokens();
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
    max_output_tokens: maxOutputTokens,
  });

  for (let i = 0; i < 12; i += 1) {
    const outputItems = Array.isArray(response.output) ? response.output : [];
    const toolCalls = outputItems.filter((item: any) => item.type === "function_call");
    if (toolCalls.length === 0) {
      break;
    }

    const toolOutputs = [];
    for (const call of toolCalls) {
      let result: unknown;
      try {
        result = await runToolCall(call, params.request.task_id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown tool execution error";
        result = {
          error: {
            code: "TOOL_EXECUTION_FAILED",
            message,
          },
        };
      }
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
      max_output_tokens: maxOutputTokens,
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
