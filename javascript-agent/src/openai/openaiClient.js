import OpenAI from "openai";
import { requireEnv } from "../config/runtime.js";

let openaiClient = null;

export function getOpenAIModel() {
  // Validates key + model together so failures are explicit and early.
  requireEnv("OPENAI_API_KEY", "OPENAI_API_KEY is required for LLM-driven decisions");
  return requireEnv("OPENAI_MODEL", "OPENAI_MODEL is required for LLM-driven decisions");
}

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
