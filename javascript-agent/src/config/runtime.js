import { AgentError } from "../utils/agentError.js";

/**
 * Centralized env loader with consistent error shape.
 * Keeps config checks in one place (DRY) and avoids scattered process.env guards.
 */
export function requireEnv(name, message = `${name} is required`) {
  const value = process.env[name];
  if (!value) {
    throw new AgentError("CONFIG_INVALID", message, false, 500);
  }
  return value;
}

export function getAuthMode() {
  const mode = (process.env.AGENT_AUTH_MODE ?? "simple").toLowerCase();
  if (mode !== "simple" && mode !== "advanced") {
    throw new AgentError(
      "CONFIG_INVALID",
      "AGENT_AUTH_MODE must be either simple or advanced",
      false,
      500,
    );
  }
  return mode;
}

export function getAgentDid() {
  return requireEnv("AGENT_DID", "AGENT_DID is required");
}
