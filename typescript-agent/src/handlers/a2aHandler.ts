import type { Request, Response } from "express";
import { runAgent } from "../agentRunner";
import { validateA2AForwardEnvelope } from "../validation/schemas";
import { verifyInboundAuth } from "../auth/inboundAuth";
import { AgentError } from "../utils/agentError";
import { logError, logInfo } from "../utils/log";

// `/a2a` is the main platform contract: validate the forwarded envelope,
// verify platform identity, run the intent, then always return a normalized
// `a2a_response`.
export async function a2aHandler(req: Request, res: Response) {
  // Keep the exact bytes because inbound JWT body_hash checks use the payload
  // the platform signed, not a re-serialized object.
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
  // Fall back to task_id so logs remain traceable when context is partial.
  const correlationId =
    typeof task.context?.correlation_id === "string" && task.context.correlation_id.length > 0
      ? task.context.correlation_id
      : task.task_id;
  const depth =
    typeof task.context?.depth === "number" ? task.context.depth : 0;

  try {
    // Do not run any business logic until the platform JWT is accepted.
    await verifyInboundAuth({
      headers: req.headers,
      rawBody: bodyRaw,
      taskId: task.task_id,
      correlationId,
    });

    logInfo("A2A request accepted", {
      task_id: task.task_id,
      correlation_id: correlationId,
      intent: task.intent,
      depth,
    });

    const result = await runAgent(task);
    // Keep the original task_id so lineage stays intact on the platform side.
    return res.json({
      type: "a2a_response",
      task_id: task.task_id,
      status: "completed",
      result,
    });
  } catch (err: unknown) {
    // Unexpected runtime failures are normalized into the platform error shape.
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
      correlation_id: correlationId,
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
