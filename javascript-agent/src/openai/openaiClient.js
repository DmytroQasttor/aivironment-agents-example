import OpenAI from "openai";
import { requireEnv } from "../config/runtime.js";
import { AgentError } from "../utils/agentError.js";

let openaiClient = null;

// Ensures model config is present before running LLM loop.
export function getOpenAIModel() {
  // Validates key + model together so failures are explicit and early.
  requireEnv("OPENAI_API_KEY", "OPENAI_API_KEY is required for LLM-driven decisions");
  return requireEnv("OPENAI_MODEL", "OPENAI_MODEL is required for LLM-driven decisions");
}

// Cost/safety guard for maximum generated output tokens.
export function getOpenAIMaxOutputTokens() {
  const raw = process.env.OPENAI_MAX_OUTPUT_TOKENS;
  if (!raw) {
    return 1200;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AgentError(
      "CONFIG_INVALID",
      "OPENAI_MAX_OUTPUT_TOKENS must be a positive integer",
      false,
      500,
    );
  }
  return parsed;
}

// Lazily creates and reuses OpenAI client.
export function getOpenAIClient() {
  if (!openaiClient) {
    const apiKey = requireEnv(
      "OPENAI_API_KEY",
      "OPENAI_API_KEY is required for LLM-driven decisions",
    );
    openaiClient = new OpenAI({
      apiKey,
    });
  }
  return openaiClient;
}
