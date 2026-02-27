import type { Request, Response } from "express";
import { AgentError } from "../utils/agentError";
import type {
  ConnectionFailureResponse,
  ConnectionForwardRequest,
  ConnectionResponse,
  ConnectionSuccessResponse,
} from "./types";

function buildFailure(
  taskId: string,
  code: string,
  message: string,
  retryable: boolean,
): ConnectionFailureResponse {
  return {
    type: "a2a_response",
    task_id: taskId,
    status: "failed",
    error: {
      code,
      message,
      retryable,
    },
  };
}

function buildSuccess(
  taskId: string,
  result: Record<string, unknown>,
): ConnectionSuccessResponse {
  return {
    type: "a2a_response",
    task_id: taskId,
    status: "completed",
    result,
  };
}

function parseForwardRequest(rawBody: Buffer): ConnectionForwardRequest {
  if (rawBody.length === 0) {
    throw new AgentError("PAYLOAD_INVALID", "Expected raw JSON body", false, 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new AgentError("PAYLOAD_INVALID", "Invalid JSON body", false, 400);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new AgentError("PAYLOAD_INVALID", "Body must be a JSON object", false, 400);
  }

  const candidate = parsed as Record<string, unknown>;
  if (candidate.type !== "a2a_forward") {
    throw new AgentError("PAYLOAD_INVALID", "type must be 'a2a_forward'", false, 400);
  }
  if (typeof candidate.task_id !== "string" || candidate.task_id.length === 0) {
    throw new AgentError("PAYLOAD_INVALID", "task_id is required", false, 400);
  }
  if (typeof candidate.intent !== "string" || candidate.intent.length === 0) {
    throw new AgentError("PAYLOAD_INVALID", "intent is required", false, 400);
  }

  return {
    type: "a2a_forward",
    task_id: candidate.task_id,
    intent: candidate.intent,
    payload: candidate.payload,
    ...(typeof candidate.timestamp === "string" ? { timestamp: candidate.timestamp } : {}),
    ...(candidate.source && typeof candidate.source === "object"
      ? { source: candidate.source as Record<string, unknown> }
      : {}),
    ...(candidate.context && typeof candidate.context === "object"
      ? { context: candidate.context as Record<string, unknown> }
      : {}),
  };
}

/**
 * Minimal `/a2a` connection endpoint factory.
 * This intentionally excludes business schema validation and intent-specific logic.
 * It only enforces endpoint contract shape and delegates execution to caller-provided function.
 */
export function createConnectionEndpoint(
  execute: (
    request: ConnectionForwardRequest,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>,
) {
  return async function connectionEndpoint(
    req: Request,
    res: Response<ConnectionResponse>,
  ) {
    const bodyRaw = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);

    let request: ConnectionForwardRequest;
    try {
      request = parseForwardRequest(bodyRaw);
    } catch (error) {
      const failure =
        error instanceof AgentError
          ? buildFailure(
              "unknown",
              error.code,
              error.message,
              error.retryable,
            )
          : buildFailure(
              "unknown",
              "PAYLOAD_INVALID",
              "Invalid request payload",
              false,
            );
      return res.status(400).json(failure);
    }

    try {
      const result = await execute(request);
      return res.json(buildSuccess(request.task_id, result));
    } catch (error) {
      const failure =
        error instanceof AgentError
          ? buildFailure(
              request.task_id,
              error.code,
              error.message,
              error.retryable,
            )
          : buildFailure(
              request.task_id,
              "EXECUTION_FAILED",
              error instanceof Error ? error.message : "Unhandled execution failure",
              true,
            );
      return res.status(200).json(failure);
    }
  };
}
