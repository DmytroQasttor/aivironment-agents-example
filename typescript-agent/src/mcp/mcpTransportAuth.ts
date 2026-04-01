import { buildMcpSessionAuthHeaders } from "../auth/outboundAuth";
import { logMcpDebug } from "../utils/log";

// MCP session TTL must be shorter than the platform's server-side inactivity timeout (10 min).
const MCP_SESSION_TTL_MS = 8 * 60 * 1000;

type ToolAuthSpec = {
  method: string;
  path: string;
  body: string;
  targetAgentDid?: string;
};

type FetchInput = string | URL | Request;
type FetchBody = RequestInit["body"];

type RpcToolCallParams = {
  name?: unknown;
  arguments?: unknown;
};

function summarizeAuthHeaders(authHeaders: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(authHeaders).map(([key, value]) => [
      key,
      typeof value === "string" ? value.slice(0, 32) : null,
    ]),
  );
}

async function bodyToString(body: FetchBody | null | undefined) {
  if (body == null) {
    return "";
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(body).toString("utf8");
  }
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8");
  }
  if (body instanceof ReadableStream) {
    const response = new Response(body);
    return response.text();
  }
  return String(body);
}

async function resolveRequestBody(input: FetchInput, init?: RequestInit) {
  if (init?.body !== undefined) {
    return bodyToString(init.body);
  }
  if (input instanceof Request) {
    return input.clone().text();
  }
  return "";
}

function requestMethod(input: FetchInput, init?: RequestInit) {
  if (typeof init?.method === "string" && init.method.length > 0) {
    return init.method.toUpperCase();
  }
  if (input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "POST";
}

function requestUrl(input: FetchInput) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function mergeHeaders(
  input: FetchInput,
  init: RequestInit | undefined,
  authHeaders: Record<string, string>,
) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers) {
    const initHeaders = new Headers(init.headers);
    initHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }
  for (const [key, value] of Object.entries(authHeaders)) {
    headers.set(key, value);
  }
  return headers;
}

async function resolveRequestSpec(input: FetchInput, init?: RequestInit): Promise<ToolAuthSpec> {
  const url = new URL(requestUrl(input));
  const method = requestMethod(input, init);
  const body = await resolveRequestBody(input, init);

  try {
    const parsed = JSON.parse(body) as { method?: unknown; params?: unknown };
    if (typeof parsed?.method === "string") {
      logMcpDebug("outgoing rpc request", {
        rpc_method: parsed.method,
      });
    }
  } catch {
    // Request body is not JSON-RPC. Keep raw transport values.
  }

  return {
    method,
    path: url.pathname || "/",
    body,
  };
}

export function createGovernanceMcpFetch(): typeof fetch {
  let sessionAuthHeaders: Record<string, string> | null = null;
  let sessionStartedAtMs = 0;

  async function getSessionHeaders(requestSpec: ToolAuthSpec, forceRefresh = false) {
    const nowMs = Date.now();
    const shouldCreateSession =
      forceRefresh ||
      sessionAuthHeaders == null ||
      nowMs - sessionStartedAtMs >= MCP_SESSION_TTL_MS;

    if (shouldCreateSession) {
      // The first request after connect or refresh establishes the MCP session.
      sessionAuthHeaders = await buildMcpSessionAuthHeaders(requestSpec);
      sessionStartedAtMs = nowMs;
      logMcpDebug("mcp auth session established", {
        method: requestSpec.method,
        path: requestSpec.path,
        session_ttl_ms: MCP_SESSION_TTL_MS,
        forced_refresh: forceRefresh,
      });
    }

    return {
      authHeaders: sessionAuthHeaders as Record<string, string>,
      reused: !shouldCreateSession,
    };
  }

  return async (input, init) => {
    const requestSpec = await resolveRequestSpec(input, init);
    const firstAttempt = await getSessionHeaders(requestSpec, false);
    const authHeaders = firstAttempt.authHeaders;
    const finalInit: RequestInit = {
      ...init,
      headers: mergeHeaders(input, init, authHeaders),
    };
    logMcpDebug("sending request", {
      method: requestSpec.method,
      path: requestSpec.path,
      mcp_session_reused: firstAttempt.reused,
      auth_header_present: typeof authHeaders.Authorization === "string",
      auth_header_prefix:
        typeof authHeaders.Authorization === "string" ? authHeaders.Authorization.slice(0, 16) : null,
      auth_envelope_mode: "authorization-bearer",
      auth_header_names: Object.keys(authHeaders),
      auth_header_values: summarizeAuthHeaders(authHeaders),
    });
    const response = await fetch(input, finalInit);
    if (response.status === 401) {
      logMcpDebug("mcp session unauthorized, refreshing", {
        method: requestSpec.method,
        path: requestSpec.path,
      });
      const retryAttempt = await getSessionHeaders(requestSpec, true);
      const retryResponse = await fetch(input, {
        ...init,
        headers: mergeHeaders(input, init, retryAttempt.authHeaders),
      });
      logMcpDebug("received response", {
        status: retryResponse.status,
        ok: retryResponse.ok,
        retried: true,
      });
      return retryResponse;
    }
    logMcpDebug("received response", {
      status: response.status,
      ok: response.ok,
    });
    return response;
  };
}
