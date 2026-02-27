import { AgentError } from "../utils/agentError.js";
import { isConnectionForwardRequest } from "./types.js";

function buildFailure(taskId, code, message, retryable) {
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

function buildSuccess(taskId, result) {
  return {
    type: "a2a_response",
    task_id: taskId,
    status: "completed",
    result,
  };
}

function parseForwardRequest(rawBody) {
  if (!rawBody || rawBody.length === 0) {
    throw new AgentError("PAYLOAD_INVALID", "Expected raw JSON body", false, 400);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new AgentError("PAYLOAD_INVALID", "Invalid JSON body", false, 400);
  }

  if (!isConnectionForwardRequest(parsed)) {
    throw new AgentError("PAYLOAD_INVALID", "Invalid a2a_forward payload shape", false, 400);
  }
  return parsed;
}

/**
 * Minimal `/a2a` endpoint for integration docs.
 * It enforces only base contract fields and delegates execution logic to caller.
 */
export function createConnectionEndpoint(execute) {
  return async function connectionEndpoint(req, res) {
    const bodyRaw = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);

    let request;
    try {
      request = parseForwardRequest(bodyRaw);
    } catch (error) {
      const failure =
        error instanceof AgentError
          ? buildFailure("unknown", error.code, error.message, error.retryable)
          : buildFailure("unknown", "PAYLOAD_INVALID", "Invalid request payload", false);
      return res.status(400).json(failure);
    }

    try {
      const result = await execute(request);
      return res.json(buildSuccess(request.task_id, result));
    } catch (error) {
      const failure =
        error instanceof AgentError
          ? buildFailure(request.task_id, error.code, error.message, error.retryable)
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

