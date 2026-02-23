/**
 * Shared response builders so every handler returns exactly the same contract shape.
 */
export function buildA2ASuccess(taskId, result) {
  return {
    type: "a2a_response",
    task_id: taskId,
    status: "completed",
    result,
  };
}

export function buildA2AFailure(taskId, code, message, retryable) {
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
