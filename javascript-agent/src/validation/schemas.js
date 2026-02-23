import Ajv from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

const a2aForwardSchema = {
  type: "object",
  required: ["type", "task_id", "intent", "payload", "context"],
  properties: {
    type: { const: "a2a_forward" },
    task_id: { type: "string", minLength: 1 },
    intent: { type: "string", minLength: 1 },
    payload: { type: "object" },
    context: {
      type: "object",
      required: ["correlation_id", "parent_task_id", "depth", "max_depth"],
      properties: {
        correlation_id: { type: "string", minLength: 1 },
        parent_task_id: { anyOf: [{ type: "string" }, { type: "null" }] },
        depth: { type: "integer", minimum: 0 },
        max_depth: { type: "integer", minimum: 0 },
        project_id: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
};

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
