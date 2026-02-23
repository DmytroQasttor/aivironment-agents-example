import type { Request, Response } from "express";
import { verifySignature } from "../utils/signature";
import { runAgent } from "../agentRunner";

export async function a2aHandler(req: Request, res: Response) {
  const sig = req.headers["x-platform-signature"] as string;
  const ts = req.headers["x-platform-timestamp"] as string;
  const bodyRaw = req.body as Buffer;

  if (!verifySignature(bodyRaw, sig, ts, process.env.AGENT_SECRET!)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  let task: any;
  try {
    task = JSON.parse(bodyRaw.toString());
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  try {
    const result = await runAgent(task);
    return res.json({
      type: "a2a_response",
      task_id: task.task_id,
      status: "completed",
      result,
    });
  } catch (err: any) {
    return res.json({
      type: "a2a_response",
      task_id: task.task_id,
      status: "failed",
      error: { code: "PROCESSING_FAILED", message: err.message },
    });
  }
}
