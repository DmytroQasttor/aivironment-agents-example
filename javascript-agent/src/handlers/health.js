export function healthHandler(_req, res) {
  res.status(200).json({
    status: "ok",
    agent: "execution-task-coordinator",
    auth_mode: process.env.AGENT_AUTH_MODE ?? "simple",
  });
}
