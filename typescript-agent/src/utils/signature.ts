import crypto from "crypto";

export function verifySignature(
  raw: Buffer,
  signature: string,
  timestamp: string,
  secret: string,
) {
  const age = Math.abs(Date.now() - new Date(timestamp).getTime()) / 1000;
  if (age > 300) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${raw.toString()}`)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(`sha256=${expected}`),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}
