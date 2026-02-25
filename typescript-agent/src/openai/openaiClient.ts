import OpenAI from "openai";
import { AgentError } from "../utils/agentError";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export function getOpenAIModel() {
  if (!process.env.OPENAI_API_KEY) {
    throw new AgentError(
      "CONFIG_INVALID",
      "OPENAI_API_KEY is required for LLM-driven decisions",
      false,
      500,
    );
  }
  if (!process.env.OPENAI_MODEL) {
    throw new AgentError(
      "CONFIG_INVALID",
      "OPENAI_MODEL is required for LLM-driven decisions",
      false,
      500,
    );
  }
  return process.env.OPENAI_MODEL;
}

export function getOpenAIMaxOutputTokens() {
  const rawValue = process.env.OPENAI_MAX_OUTPUT_TOKENS;
  if (!rawValue) {
    return 1200;
  }

  const parsed = Number.parseInt(rawValue, 10);
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

export async function askOpenAI(prompt: string) {
  const model = getOpenAIModel();
  const r = await openai.responses.create({
    model,
    input: prompt,
    max_output_tokens: getOpenAIMaxOutputTokens(),
  });
  return r.output_text;
}
