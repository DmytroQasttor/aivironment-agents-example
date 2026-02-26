import type { Request, Response } from "express";

// Lightweight probe endpoint for deploy checks and platform health monitoring.
export function healthHandler(req: Request, res: Response) {
  res.status(200).json({
    status: "ok",
    agent: "delivery-planning-coordinator",
    auth_mode: process.env.AGENT_AUTH_MODE ?? "simple",
  });
}
