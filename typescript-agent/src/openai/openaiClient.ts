import OpenAI from "openai";

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function askOpenAI(prompt: string) {
  const r = await openai.responses.create({
    model: process.env.OPENAI_MODEL!,
    input: prompt,
  });
  return r.output_text;
}
