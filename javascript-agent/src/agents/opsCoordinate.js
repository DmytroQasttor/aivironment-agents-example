import { getOpenAIClient, getOpenAIModel } from "../openai/openaiClient.js";
import {
  mcpDelegateTask,
  mcpGetRouteDetails,
  mcpGetTaskContext,
  mcpListReachableRoutes,
} from "../mcp/mcpClientHttp.js";
import { AgentError } from "../utils/agentError.js";
import { logInfo } from "../utils/log.js";
import {
  validateOpsCoordinateInput,
  validateOpsCoordinateLlmDecision,
  validateOpsCoordinateOutput,
} from "../validation/schemas.js";

function normalizeRouteCandidates(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object" && Array.isArray(value.routes)) {
    return value.routes;
  }
  return [];
}

function routeSupportsAudit(route) {
  if (!route || !route.connection_slug || !route.target_agent_did) {
    return false;
  }
  if (typeof route.active === "boolean" && !route.active) {
    return false;
  }

  if (route.intent === "ops.audit") {
    return true;
  }

  if (Array.isArray(route.allowed_intents)) {
    return route.allowed_intents.includes("ops.audit");
  }

  return true;
}

function pickAuditRoute(routes) {
  return routes.find(routeSupportsAudit);
}

async function decideWithLlm({ request, payload, taskContext, routes }) {
  const model = getOpenAIModel();
  const prompt = [
    "You are Execution Task Coordinator.",
    "Return only valid JSON with keys:",
    "- plan: string",
    "- actions: array",
    "- optional score: number 0..1",
    "- delegate_compliance: boolean",
    "- optional delegation_reason: string",
    "- optional compliance_payload: object for ops.audit intent",
    "Set delegate_compliance=true when compliance or risk should be audited and depth allows.",
    "",
    JSON.stringify(
      {
        task_id: request.task_id,
        intent: request.intent,
        payload,
        context: request.context,
        task_context: taskContext,
        reachable_routes: routes,
      },
      null,
      2,
    ),
  ].join("\n");

  const openai = getOpenAIClient();
  const response = await openai.responses.create({
    model,
    input: prompt,
  });

  let parsed;
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

  const validated = validateOpsCoordinateLlmDecision(parsed);
  if (!validated.ok) {
    throw new AgentError(
      "EXECUTION_FAILED",
      `LLM decision schema invalid: ${validated.errors.join("; ")}`,
      true,
      502,
    );
  }
  return validated.value;
}

function buildCompliancePayload({ llmDecision, payload }) {
  if (llmDecision.compliance_payload && typeof llmDecision.compliance_payload === "object") {
    return llmDecision.compliance_payload;
  }

  return {
    objective: payload.objective,
    priority: payload.priority,
    constraints: payload.constraints,
    metadata: payload.metadata,
    compliance_focus: [
      "regulatory_risk",
      "data_handling",
      "operational_controls",
    ],
  };
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
  const taskContext = await mcpGetTaskContext(
    request.task_id,
    request.context.correlation_id,
  );
  const reachableRoutes = normalizeRouteCandidates(
    await mcpListReachableRoutes("ops.audit"),
  ).filter((route) => route.active !== false);

  const llmDecision = await decideWithLlm({
    request,
    payload,
    taskContext,
    routes: reachableRoutes,
  });

  const result = {
    plan: llmDecision.plan,
    actions: llmDecision.actions,
    ...(typeof llmDecision.score === "number" ? { score: llmDecision.score } : {}),
  };

  const canDelegate = request.context.depth < request.context.max_depth;
  const wantsDelegate = llmDecision.delegate_compliance === true;
  if (!wantsDelegate || !canDelegate) {
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

  const selectedRoute = pickAuditRoute(reachableRoutes);
  if (!selectedRoute) {
    logInfo("No ops.audit route found, completing locally", {
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

  const compliancePayload = buildCompliancePayload({ llmDecision, payload });
  await mcpDelegateTask({
    connectionSlug: selectedRoute.connection_slug,
    targetAgentDid: selectedRoute.target_agent_did,
    intent: "ops.audit",
    payload: compliancePayload,
    context: {
      correlation_id: request.context.correlation_id,
      parent_task_id: request.task_id,
      depth: request.context.depth + 1,
      max_depth: request.context.max_depth,
      project_id: request.context.project_id ?? null,
    },
  });

  result.actions.push({
    type: "delegation",
    target_intent: "ops.audit",
    connection_slug: selectedRoute.connection_slug,
    target_agent_did: selectedRoute.target_agent_did,
    reason: llmDecision.delegation_reason ?? "llm_delegate_compliance",
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
