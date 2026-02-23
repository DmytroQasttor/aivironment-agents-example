import express from "express";
import "dotenv/config";
import { healthHandler } from "./handlers/health";
import { a2aHandler } from "./handlers/a2aHandler";

const app = express();
app.use(express.raw({ type: "application/json" }));

app.get("/health", healthHandler);
app.post("/a2a", a2aHandler);

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Agent listening on port ${PORT}`);
});
