import type { Request, Response } from "express";
import { runAgent } from "../agentRunner";
import { validateA2AForwardEnvelope } from "../validation/schemas";
import { verifyInboundAuth } from "../auth/inboundAuth";
import { AgentError } from "../utils/agentError";
import { logError, logInfo } from "../utils/log";

export async function a2aHandler(req: Request, res: Response) {
  const bodyRaw = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
  if (bodyRaw.length === 0) {
    return res.status(400).json({
      type: "a2a_response",
      task_id: "unknown",
      status: "failed",
      error: {
        code: "PAYLOAD_INVALID",
        message: "Expected raw JSON body",
        retryable: false,
      },
    });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(bodyRaw.toString("utf-8"));
  } catch {
    return res.status(400).json({
      type: "a2a_response",
      task_id: "unknown",
      status: "failed",
      error: {
        code: "PAYLOAD_INVALID",
        message: "Invalid JSON body",
        retryable: false,
      },
    });
  }

  const envelopeValidation = validateA2AForwardEnvelope(parsedBody);
  if (!envelopeValidation.ok) {
    return res.status(400).json({
      type: "a2a_response",
      task_id: "unknown",
      status: "failed",
      error: {
        code: "PAYLOAD_INVALID",
        message: `Envelope failed validation: ${envelopeValidation.errors.join("; ")}`,
        retryable: false,
      },
    });
  }
  const task = envelopeValidation.value;

  try {
    await verifyInboundAuth({
      headers: req.headers,
      rawBody: bodyRaw,
      taskId: task.task_id,
      correlationId: task.context.correlation_id,
    });

    logInfo("A2A request accepted", {
      task_id: task.task_id,
      correlation_id: task.context.correlation_id,
      intent: task.intent,
      depth: task.context.depth,
    });

    const result = await runAgent(task);
    return res.json({
      type: "a2a_response",
      task_id: task.task_id,
      status: "completed",
      result,
    });
  } catch (err: unknown) {
    const agentError =
      err instanceof AgentError
        ? err
        : new AgentError(
            "EXECUTION_FAILED",
            err instanceof Error ? err.message : "Unexpected execution error",
            true,
            500,
          );

    logError("A2A request failed", {
      task_id: task.task_id,
      correlation_id: task.context.correlation_id,
      code: agentError.code,
      message: agentError.message,
    });

    return res.json({
      type: "a2a_response",
      task_id: task.task_id,
      status: "failed",
      error: {
        code: agentError.code,
        message: agentError.message,
        retryable: agentError.retryable,
      },
    });
  }
}
