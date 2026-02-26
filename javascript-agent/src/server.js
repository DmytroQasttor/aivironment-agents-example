import "dotenv/config";
import express from "express";
import { a2aHandler } from "./handlers/a2aHandler.js";
import { healthHandler } from "./handlers/health.js";

const app = express();
// Keep raw JSON bytes available for inbound body-hash verification.
app.use(express.raw({ type: "application/json" }));

app.get("/health", healthHandler);
app.post("/a2a", a2aHandler);

const port = process.env.PORT || 3200;
app.listen(port, () => {
  console.log(`Execution Task Coordinator listening on port ${port}`);
});
