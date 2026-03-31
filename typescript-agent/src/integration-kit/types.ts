/**
 * Integration kit — minimal A2A type definitions.
 *
 * These types describe the platform's request/response envelope shapes.
 * They are intentionally thin: no intent-specific fields, no business logic.
 *
 * When building your own agent:
 * - Keep ConnectionForwardRequest as-is — the platform always sends this shape.
 * - Add your intent-specific input/output types in src/types/a2a.ts instead.
 * - The `payload` field will contain whatever your intent's input schema defines.
 */
export interface ConnectionForwardRequest {
  type: "a2a_forward";
  task_id: string;
  timestamp?: string;
  source?: Record<string, unknown>;
  intent: string;
  payload: unknown;
  context?: Record<string, unknown>;
}

export interface ConnectionSuccessResponse {
  type: "a2a_response";
  task_id: string;
  status: "completed";
  result: Record<string, unknown>;
}

export interface ConnectionFailureResponse {
  type: "a2a_response";
  task_id: string;
  status: "failed";
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export type ConnectionResponse = ConnectionSuccessResponse | ConnectionFailureResponse;

