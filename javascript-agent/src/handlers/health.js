import { buildHealthPayload } from "../integration-kit/healthEndpoint.js";

// Lightweight deploy probe endpoint.
export function healthHandler(_req, res) {
  res.status(200).json(
    buildHealthPayload({
      agentName: "execution-task-coordinator",
      authMode: process.env.AGENT_AUTH_MODE ?? "simple",
    }),
  );
}
