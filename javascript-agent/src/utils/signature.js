import crypto from "node:crypto";

export function verifySignature(raw, signature, timestamp, secret) {
  if (!signature || !timestamp || !secret) {
    return false;
  }

  const parsedTs = new Date(timestamp).getTime();
  if (Number.isNaN(parsedTs)) {
    return false;
  }

  const age = Math.abs(Date.now() - parsedTs) / 1000;
  if (age > 300) {
    return false;
  }

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
