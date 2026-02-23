import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { A2AForwardRequest, OpsCoordinatePayload, OpsCoordinateResult } from "../types/a2a";

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

const a2aForwardSchema = {
  type: "object",
  required: [
    "type",
    "task_id",
    "timestamp",
    "source",
    "intent",
    "payload",
    "context",
  ],
  properties: {
    type: { const: "a2a_forward" },
    task_id: { type: "string", minLength: 1 },
    timestamp: { type: "string", minLength: 1 },
    source: {
      type: "object",
      required: ["agent_id", "agent_name", "workspace_id", "workspace_name"],
      properties: {
        agent_id: { type: "string", minLength: 1 },
        agent_name: { type: "string", minLength: 1 },
        workspace_id: { type: "string", minLength: 1 },
        workspace_name: { type: "string", minLength: 1 },
      },
      additionalProperties: true,
    },
    intent: { type: "string", minLength: 1 },
    payload: { type: "object" },
    context: {
      type: "object",
      required: [
        "project_id",
        "correlation_id",
        "depth",
        "max_depth",
        "parent_task_id",
      ],
      properties: {
        project_id: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        correlation_id: { type: "string", minLength: 1 },
        depth: { type: "integer", minimum: 0 },
        max_depth: { type: "integer", minimum: 0 },
        parent_task_id: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: true,
} as const;

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
    mode: {
      type: "object",
      properties: {
        name: { type: "string" },
        version: { type: "integer", minimum: 1 },
      },
      additionalProperties: true,
    },
    due_date: { type: "string", format: "date" },
    iteration: { type: "integer", minimum: 1 },
    budget_limit: { type: "number", minimum: 0 },
  },
  additionalProperties: true,
} as const;

const opsCoordinateOutputSchema = {
  type: "object",
  required: ["plan", "actions"],
  properties: {
    plan: { type: "string", minLength: 1 },
    actions: { type: "array" },
    score: { type: "number" },
  },
  additionalProperties: true,
} as const;

const validateA2AForwardInternal = ajv.compile(a2aForwardSchema);
const validateOpsCoordinateInputInternal = ajv.compile(opsCoordinateInputSchema);
const validateOpsCoordinateOutputInternal = ajv.compile(opsCoordinateOutputSchema);

export function validateA2AForwardEnvelope(value: unknown): {
  ok: true;
  value: A2AForwardRequest;
} | {
  ok: false;
  errors: string[];
} {
  const ok = validateA2AForwardInternal(value);
  if (!ok) {
    return {
      ok: false,
      errors: (validateA2AForwardInternal.errors ?? []).map(
        (e) => `${e.instancePath || "/"} ${e.message}`,
      ),
    };
  }
  return { ok: true, value: value as A2AForwardRequest };
}

export function validateOpsCoordinateInput(value: unknown): {
  ok: true;
  value: OpsCoordinatePayload;
} | {
  ok: false;
  errors: string[];
} {
  const ok = validateOpsCoordinateInputInternal(value);
  if (!ok) {
    return {
      ok: false,
      errors: (validateOpsCoordinateInputInternal.errors ?? []).map(
        (e) => `${e.instancePath || "/"} ${e.message}`,
      ),
    };
  }
  return { ok: true, value: value as OpsCoordinatePayload };
}

export function validateOpsCoordinateOutput(value: unknown): {
  ok: true;
  value: OpsCoordinateResult;
} | {
  ok: false;
  errors: string[];
} {
  const ok = validateOpsCoordinateOutputInternal(value);
  if (!ok) {
    return {
      ok: false,
      errors: (validateOpsCoordinateOutputInternal.errors ?? []).map(
        (e) => `${e.instancePath || "/"} ${e.message}`,
      ),
    };
  }
  return { ok: true, value: value as OpsCoordinateResult };
}
