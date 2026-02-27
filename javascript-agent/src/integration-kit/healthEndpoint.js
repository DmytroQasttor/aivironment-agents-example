/**
 * Minimal `/health` payload builder for frontend/public integration docs.
 */
export function buildHealthPayload({ agentName, authMode }) {
  return {
    status: "ok",
    agent: agentName,
    auth_mode: authMode,
  };
}

