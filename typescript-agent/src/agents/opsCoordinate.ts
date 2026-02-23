import type { A2AForwardRequest, OpsCoordinatePayload, OpsCoordinateResult } from "../types/a2a";
import { mcpDelegateTask, mcpGetRouteDetails, mcpGetTaskContext, mcpListReachableRoutes } from "../mcp/mcpClientHttp";
import { AgentError } from "../utils/agentError";
import { logInfo } from "../utils/log";
import { validateOpsCoordinateInput, validateOpsCoordinateOutput } from "../validation/schemas";

interface RouteCandidate {
  connection_slug?: string;
  target_agent_did?: string;
  intent?: string;
  active?: boolean;
}

function getPriorityWeight(priority: OpsCoordinatePayload["priority"]) {
  switch (priority) {
    case "low":
      return 0.2;
    case "medium":
      return 0.4;
    case "high":
      return 0.7;
    case "critical":
      return 1;
  }
}

function computeScore(input: OpsCoordinatePayload) {
  const base = 0.35;
  const risk = input.metadata.risk_score * 0.4;
  const priority = getPriorityWeight(input.priority) * 0.25;
  return Number(Math.min(1, base + risk + priority).toFixed(2));
}

function buildLocalPlan(input: OpsCoordinatePayload): OpsCoordinateResult {
  const score = computeScore(input);
  const actions = input.constraints.map((constraint, index) => ({
    id: `A${index + 1}`,
    type: "constraint_mitigation",
    owner: input.metadata.owner,
    note: `Mitigate constraint: ${constraint}`,
  }));

  actions.unshift(
    {
      id: "A0",
      type: "planning_kickoff",
      owner: input.metadata.owner,
      note: `Initiate execution planning in ${input.metadata.region}`,
    },
    {
      id: "A0.5",
      type: "risk_review",
      owner: input.metadata.owner,
      note: `Perform risk review at score ${input.metadata.risk_score.toFixed(2)}`,
    },
  );

  const dueText = input.due_date ? ` Delivery due by ${input.due_date}.` : "";
  return {
    plan: `Coordinate objective "${input.objective}" at priority ${input.priority}.${dueText}`,
    actions,
    score,
  };
}

function shouldDelegate(input: OpsCoordinatePayload, request: A2AForwardRequest) {
  if (request.context.depth >= request.context.max_depth) {
    return false;
  }
  return input.priority === "critical" || input.metadata.risk_score >= 0.8;
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
  const result = buildLocalPlan(payload);

  if (!shouldDelegate(payload, request)) {
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

  logInfo("Delegation criteria met", {
    task_id: request.task_id,
    correlation_id: request.context.correlation_id,
    depth: request.context.depth,
  });

  const taskContext = await mcpGetTaskContext(
    request.task_id,
    request.context.correlation_id,
  );
  const reachableRoutes = normalizeRouteCandidates(
    await mcpListReachableRoutes("ops.coordinate"),
  );
  const selectedRoute = pickRoute(reachableRoutes);

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
      delegation_reason: "critical_priority_or_high_risk",
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
