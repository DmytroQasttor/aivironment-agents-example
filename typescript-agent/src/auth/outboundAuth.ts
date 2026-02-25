import crypto from "node:crypto";
import { importPKCS8, SignJWT } from "jose";
import { AgentError } from "../utils/agentError";

type AuthMode = "simple" | "advanced";

let privateKeyPromise: ReturnType<typeof importPKCS8> | null = null;

function getAuthMode(): AuthMode {
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

function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function buildCanonicalString(params: {
  method: string;
  path: string;
  timestampMs: string;
  targetAgentDid?: string;
  body: string;
}) {
  return [
    params.method.toUpperCase(),
    params.path,
    params.timestampMs,
    params.targetAgentDid ?? "",
    `sha256:${sha256Hex(params.body)}`,
  ].join("\n");
}

async function getPrivateKey(alg: string) {
  if (!privateKeyPromise) {
    const keyPem = process.env.AGENT_PRIVATE_KEY_PEM;
    if (!keyPem) {
      throw new AgentError(
        "CONFIG_INVALID",
        "AGENT_PRIVATE_KEY_PEM is required for advanced auth mode",
        false,
        500,
      );
    }
    privateKeyPromise = importPKCS8(keyPem, alg);
  }
  return privateKeyPromise;
}

export async function buildOutboundAuthHeaders(params: {
  method: string;
  path: string;
  body: string;
  targetAgentDid?: string;
}) {
  const mode = getAuthMode();
  const agentDid = process.env.AGENT_DID;
  if (!agentDid) {
    throw new AgentError("CONFIG_INVALID", "AGENT_DID is required", false, 500);
  }

  if (mode === "simple") {
    if (!process.env.AGENT_API_KEY) {
      throw new AgentError(
        "CONFIG_INVALID",
        "AGENT_API_KEY is required for simple auth mode",
        false,
        500,
      );
    }

    return {
      Authorization: `Bearer ${process.env.AGENT_API_KEY}`,
      "X-Agent-ID": agentDid,
    };
  }

  const alg = process.env.AGENT_SIGNATURE_ALGORITHM ?? "RS256";
  const kid = process.env.AGENT_KEY_ID;
  const timestampMs = Date.now().toString();
  const canonical = buildCanonicalString({
    method: params.method,
    path: params.path,
    timestampMs,
    targetAgentDid: params.targetAgentDid,
    body: params.body,
  });

  const nowSec = Math.floor(Date.now() / 1000);
  const signature = await new SignJWT({ canonical })
    .setProtectedHeader({ alg, ...(kid ? { kid } : {}) })
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 60)
    .sign(await getPrivateKey(alg));

  return {
    "X-Agent-ID": agentDid,
    "X-Timestamp": timestampMs,
    "X-Signature": signature,
    "X-Signature-Algorithm": alg,
  };
}
