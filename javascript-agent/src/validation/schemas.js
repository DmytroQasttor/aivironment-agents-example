import Ajv from "ajv";
import addFormats from "ajv-formats";

// Strict validation keeps examples aligned with production contracts.
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

// Envelope schema forwarded by platform to `/a2a`.
const a2aForwardSchema = {
  type: "object",
  required: ["type", "task_id", "timestamp", "source", "intent", "payload", "context"],
  properties: {
    type: { const: "a2a_forward" },
    task_id: { type: "string", minLength: 1 },
    timestamp: { type: "string", minLength: 1 },
    source: {
      type: "object",
      required: ["agent_id", "agent_name", "workspace_id"],
      properties: {
        agent_id: { type: "string", minLength: 1 },
        agent_name: { type: "string", minLength: 1 },
        workspace_id: { type: "string", minLength: 1 },
      },
      additionalProperties: true,
    },
    intent: { type: "string", minLength: 1 },
    payload: {},
    context: {
      type: "object",
      properties: {
        correlation_id: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] },
        parent_task_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        depth: { anyOf: [{ type: "integer", minimum: 0 }, { type: "number", minimum: 0 }, { type: "null" }] },
        max_depth: { anyOf: [{ type: "integer", minimum: 0 }, { type: "number", minimum: 0 }, { type: "null" }] },
        project_id: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};

// Blueprint 02 input schema for `ops.orchestrate`.
const opsCoordinateInputSchema = {
  type: "object",
  required: ["objective", "priority", "constraints", "metadata"],
  properties: {
    objective: { type: "string", minLength: 1 },
    priority: {
      type: "string",
      enum: ["low", "medium", "high", "critical"],
    },
    constraints: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
    },
    metadata: {
      type: "object",
      required: ["owner", "region", "risk_score"],
      properties: {
        owner: { type: "string" },
        region: { type: "string" },
        risk_score: { type: "number", minimum: 0, maximum: 1 },
      },
      additionalProperties: true,
    },
    due_date: { type: "string", format: "date" },
    iteration: { type: "integer", minimum: 1 },
  },
  additionalProperties: true,
};

// Blueprint 02 output schema for response result.
const opsCoordinateOutputSchema = {
  type: "object",
  required: ["plan", "actions"],
  properties: {
    plan: { type: "string", minLength: 1 },
    actions: { type: "array" },
    score: { type: "number" },
  },
  additionalProperties: true,
};

// Optional schema for intermediate model decision format.
const llmDecisionSchema = {
  type: "object",
  required: ["plan", "actions", "delegate_compliance"],
  properties: {
    plan: { type: "string", minLength: 1 },
    actions: { type: "array" },
    score: { type: "number", minimum: 0, maximum: 1 },
    delegate_compliance: { type: "boolean" },
    delegation_reason: { type: "string" },
    compliance_payload: { type: "object" },
  },
  additionalProperties: true,
};

const validateA2A = ajv.compile(a2aForwardSchema);
const validateInput = ajv.compile(opsCoordinateInputSchema);
const validateOutput = ajv.compile(opsCoordinateOutputSchema);
const validateLlmDecision = ajv.compile(llmDecisionSchema);

function formatErrors(errors) {
  return (errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`);
}

// Validation wrappers return normalized error strings used by handlers.
export function validateA2AForwardEnvelope(value) {
  const ok = validateA2A(value);
  return ok
    ? { ok: true, value }
    : { ok: false, errors: formatErrors(validateA2A.errors) };
}

export function validateOpsCoordinateInput(value) {
  const ok = validateInput(value);
  return ok
    ? { ok: true, value }
    : { ok: false, errors: formatErrors(validateInput.errors) };
}

export function validateOpsCoordinateOutput(value) {
  const ok = validateOutput(value);
  return ok
    ? { ok: true, value }
    : { ok: false, errors: formatErrors(validateOutput.errors) };
}

export function validateOpsCoordinateLlmDecision(value) {
  const ok = validateLlmDecision(value);
  return ok
    ? { ok: true, value }
    : { ok: false, errors: formatErrors(validateLlmDecision.errors) };
}
