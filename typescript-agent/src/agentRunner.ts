import type { A2AForwardRequest } from "./types/a2a";
import { runOpsCoordinate } from "./agents/opsCoordinate";
import { AgentError } from "./utils/agentError";

/**
 * Central intent router.
 * Add new intent handlers here as new blueprint agents are introduced.
 */
export async function runAgent(task: A2AForwardRequest) {
  switch (task.intent) {
    case "ops.coordinate":
      return runOpsCoordinate(task);
    default:
      throw new AgentError(
        "INTENT_UNSUPPORTED",
        `Unsupported intent: ${task.intent}`,
        false,
        400,
      );
  }
}
