import OpenAI from "openai";
import { AgentError } from "../utils/agentError.js";

let openaiClient = null;

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

export function getOpenAIClient() {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) {
      throw new AgentError(
        "CONFIG_INVALID",
        "OPENAI_API_KEY is required for LLM-driven decisions",
        false,
        500,
      );
    }
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}
