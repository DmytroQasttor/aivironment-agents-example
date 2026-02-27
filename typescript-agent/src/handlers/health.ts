import type { Request, Response } from "express";
import { buildHealthPayload } from "../integration-kit/healthEndpoint";

// Lightweight probe endpoint for deploy checks and platform health monitoring.
export function healthHandler(req: Request, res: Response) {
  res.status(200).json(
    buildHealthPayload({
      agentName: "delivery-planning-coordinator",
      authMode: process.env.AGENT_AUTH_MODE ?? "simple",
    }),
  );
}
