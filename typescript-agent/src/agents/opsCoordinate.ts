import type { A2AForwardRequest, OpsCoordinatePayload, OpsCoordinateResult } from "../types/a2a";
import { mcpDelegateTask, mcpGetRouteDetails, mcpGetTaskContext, mcpListReachableRoutes } from "../mcp/mcpClientHttp";
import { AgentError } from "../utils/agentError";
import { logInfo } from "../utils/log";
import { validateOpsCoordinateInput, validateOpsCoordinateLlmDecision, validateOpsCoordinateOutput } from "../validation/schemas";
import { getOpenAIModel, openai } from "../openai/openaiClient";

interface RouteCandidate {
  connection_slug?: string;
  target_agent_did?: string;
  intent?: string;
  active?: boolean;
}

function normalizeRouteCandidates(value: unknown): RouteCandidate[] {
  if (Array.isArray(value)) {
    return value as RouteCandidate[];
  }
  if (value && typeof value === "object" && Array.isArray((value as { routes?: unknown }).routes)) {
    return (value as { routes: RouteCandidate[] }).routes;
  }
  return [];
}

function pickRoute(routes: RouteCandidate[]) {
  return routes.find((r) => {
    if (!r.connection_slug || !r.target_agent_did) {
      return false;
    }
    if (typeof r.active === "boolean" && !r.active) {
      return false;
    }
    return true;
  });
}

async function decideWithLlm(params: {
  request: A2AForwardRequest;
  payload: OpsCoordinatePayload;
  taskContext: unknown;
  routes: RouteCandidate[];
}) {
  const model = getOpenAIModel();
  const input = [
    "You are Delivery Planning Coordinator.",
    "Return only valid JSON with fields:",
    "- decision: \"local\" | \"delegate\"",
    "- plan: string",
    "- actions: array",
    "- optional score: number from 0 to 1",
    "- optional delegation_reason: string",
    "- optional selected_route: { connection_slug: string, target_agent_did: string }",
    "Prefer delegate for critical/high-risk if route exists and depth allows.",
    "",
    JSON.stringify(
      {
        task_id: params.request.task_id,
        intent: params.request.intent,
        context: params.request.context,
        payload: params.payload,
        task_context: params.taskContext,
        reachable_routes: params.routes,
      },
      null,
      2,
    ),
  ].join("\n");

  const response = await openai.responses.create({
    model,
    input,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.output_text);
  } catch {
    throw new AgentError(
      "EXECUTION_FAILED",
      "LLM decision output was not valid JSON",
      true,
      502,
    );
  }

  const decisionValidation = validateOpsCoordinateLlmDecision(parsed);
  if (!decisionValidation.ok) {
    throw new AgentError(
      "EXECUTION_FAILED",
      `LLM decision schema invalid: ${decisionValidation.errors.join("; ")}`,
      true,
      502,
    );
  }

  return decisionValidation.value;
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
  const taskContext = await mcpGetTaskContext(
    request.task_id,
    request.context.correlation_id,
  );
  const reachableRoutesRaw = normalizeRouteCandidates(
    await mcpListReachableRoutes("ops.coordinate"),
  );
  const reachableRoutes = reachableRoutesRaw.filter((route) => route.active !== false);

  const llmDecision = await decideWithLlm({
    request,
    payload,
    taskContext,
    routes: reachableRoutes,
  });

  const result: OpsCoordinateResult = {
    plan: llmDecision.plan,
    actions: llmDecision.actions as Array<Record<string, unknown>>,
    ...(typeof llmDecision.score === "number" ? { score: llmDecision.score } : {}),
  };

  const depthLimited = request.context.depth >= request.context.max_depth;
  const shouldDelegate = llmDecision.decision === "delegate" && !depthLimited;
  if (!shouldDelegate) {
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

  logInfo("LLM requested delegation", {
    task_id: request.task_id,
    correlation_id: request.context.correlation_id,
    depth: request.context.depth,
    delegation_reason: llmDecision.delegation_reason ?? "unspecified",
  });

  const preferredRoute = llmDecision.selected_route
    ? reachableRoutes.find(
        (r) =>
          r.connection_slug === llmDecision.selected_route?.connection_slug &&
          r.target_agent_did === llmDecision.selected_route?.target_agent_did,
      )
    : undefined;
  const selectedRoute = preferredRoute ?? pickRoute(reachableRoutes);

  if (!selectedRoute || !selectedRoute.connection_slug || !selectedRoute.target_agent_did) {
    logInfo("No active route found, falling back to local completion", {
      task_id: request.task_id,
      correlation_id: request.context.correlation_id,
    });
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

  await mcpGetRouteDetails(
    selectedRoute.connection_slug,
    selectedRoute.target_agent_did,
  );

  await mcpDelegateTask({
    connectionSlug: selectedRoute.connection_slug,
    targetAgentDid: selectedRoute.target_agent_did,
    intent: "ops.coordinate",
    payload: {
      ...payload,
      delegated_by: process.env.AGENT_DID ?? "unknown",
      delegation_reason: llmDecision.delegation_reason ?? "llm_delegate",
      source_task_context: taskContext,
    },
    context: {
      correlation_id: request.context.correlation_id,
      parent_task_id: request.task_id,
      depth: request.context.depth + 1,
      max_depth: request.context.max_depth,
      project_id: request.context.project_id,
    },
  });

  result.actions.push({
    id: `A${result.actions.length + 1}`,
    type: "delegation",
    note: `Delegated to ${selectedRoute.target_agent_did} via ${selectedRoute.connection_slug}`,
  });

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
