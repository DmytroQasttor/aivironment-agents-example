import crypto from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { AgentError } from "../utils/agentError.js";

let privateKeyPromise = null;

function getAuthMode() {
  const mode = (process.env.AGENT_AUTH_MODE ?? "simple").toLowerCase();
  if (mode !== "simple" && mode !== "advanced") {
    throw new AgentError(
      "CONFIG_INVALID",
      "AGENT_AUTH_MODE must be either simple or advanced",
      false,
      500,
    );
  }
  return mode;
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function buildCanonicalString({ method, path, timestampMs, targetAgentDid, body }) {
  return [
    method.toUpperCase(),
    path,
    timestampMs,
    targetAgentDid ?? "",
    `sha256:${sha256Hex(body)}`,
  ].join("\n");
}

async function getPrivateKey(alg) {
  if (!privateKeyPromise) {
    if (!process.env.AGENT_PRIVATE_KEY_PEM) {
      throw new AgentError(
        "CONFIG_INVALID",
        "AGENT_PRIVATE_KEY_PEM is required for advanced auth mode",
        false,
        500,
      );
    }
    privateKeyPromise = importPKCS8(process.env.AGENT_PRIVATE_KEY_PEM, alg);
  }
  return privateKeyPromise;
}

export async function buildOutboundAuthHeaders({
  method,
  path,
  body,
  targetAgentDid,
}) {
  if (!process.env.AGENT_DID) {
    throw new AgentError("CONFIG_INVALID", "AGENT_DID is required", false, 500);
  }

  if (getAuthMode() === "simple") {
    if (!process.env.AGENT_API_KEY) {
      throw new AgentError(
        "CONFIG_INVALID",
        "AGENT_API_KEY is required for simple auth mode",
        false,
        500,
      );
    }
    return {
      "X-Authorization": `Bearer ${process.env.AGENT_API_KEY}`,
      "X-Agent-ID": process.env.AGENT_DID,
    };
  }

  const alg = process.env.AGENT_SIGNATURE_ALGORITHM ?? "RS256";
  const timestampMs = Date.now().toString();
  const canonical = buildCanonicalString({
    method,
    path,
    timestampMs,
    targetAgentDid,
    body,
  });
  const nowSec = Math.floor(Date.now() / 1000);
  const signature = await new SignJWT({ canonical })
    .setProtectedHeader({
      alg,
      ...(process.env.AGENT_KEY_ID ? { kid: process.env.AGENT_KEY_ID } : {}),
    })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 60)
    .sign(await getPrivateKey(alg));

  return {
    "X-Agent-ID": process.env.AGENT_DID,
    "X-Timestamp": timestampMs,
    "X-Signature": signature,
    "X-Signature-Algorithm": alg,
  };
}
