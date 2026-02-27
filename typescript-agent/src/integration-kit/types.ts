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

