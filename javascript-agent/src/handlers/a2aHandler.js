import { runAgent } from "../agentRunner.js";
import { verifyInboundAuth } from "../auth/inboundAuth.js";
import { AgentError } from "../utils/agentError.js";
import { buildA2AFailure, buildA2ASuccess } from "../utils/a2aResponse.js";
import { logError, logInfo } from "../utils/log.js";
import { validateA2AForwardEnvelope } from "../validation/schemas.js";

export async function a2aHandler(req, res) {
  // Raw body is required because signature verification must use exact bytes.
  const bodyRaw = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
  if (bodyRaw.length === 0) {
    return res
      .status(400)
      .json(buildA2AFailure("unknown", "PAYLOAD_INVALID", "Expected raw JSON body", false));
  }

  let parsedBody;
  try {
    parsedBody = JSON.parse(bodyRaw.toString("utf-8"));
  } catch {
    return res
      .status(400)
      .json(buildA2AFailure("unknown", "PAYLOAD_INVALID", "Invalid JSON body", false));
  }

  const envelopeValidation = validateA2AForwardEnvelope(parsedBody);
  if (!envelopeValidation.ok) {
    return res.status(400).json(
      buildA2AFailure(
        "unknown",
        "PAYLOAD_INVALID",
        `Envelope failed validation: ${envelopeValidation.errors.join("; ")}`,
        false,
      ),
    );
  }
  const task = envelopeValidation.value;

  try {
    // Verify platform identity before any business logic.
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
    return res.json(buildA2ASuccess(task.task_id, result));
  } catch (err) {
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

    return res
      .status(agentError.statusCode)
      .json(
        buildA2AFailure(
          task.task_id,
          agentError.code,
          agentError.message,
          agentError.retryable,
        ),
      );
  }
}
