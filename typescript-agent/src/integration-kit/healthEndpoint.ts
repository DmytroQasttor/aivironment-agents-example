/**
 * Integration kit — minimal /health endpoint builder.
 *
 * Returns the standard health payload shape the platform expects.
 * The platform uses /health to confirm the agent is reachable before
 * routing tasks to it.
 *
 * When building your own agent:
 * - Keep `status: "ok"` as-is — do not add business logic to the health check.
 * - Update `agentName` to match the name you registered in the platform.
 * - `authMode` should reflect your AGENT_AUTH_MODE env value ("simple" or "advanced").
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

