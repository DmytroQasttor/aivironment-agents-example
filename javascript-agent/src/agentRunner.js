import { AgentError } from "./utils/agentError.js";
import { runOpsCoordinate } from "./agents/opsCoordinate.js";

// Intent router for this agent profile. Add new intents here for future blueprints.
export async function runAgent(task) {
  switch (task.intent) {
    case "ops.orchestrate":
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
