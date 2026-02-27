/**
 * Minimal `/health` payload builder used in documentation-focused integrations.
 * Keeps health endpoint concerns independent from business agent logic.
 */
export function buildHealthPayload(params: {
  agentName: string;
  authMode: string;
}) {
  return {
    status: "ok",
    agent: params.agentName,
    auth_mode: params.authMode,
  };
}

