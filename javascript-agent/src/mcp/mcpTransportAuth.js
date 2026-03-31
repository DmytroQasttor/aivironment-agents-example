import { buildMcpSessionAuthHeaders } from "../auth/outboundAuth.js";

const MCP_SESSION_TTL_MS = 15 * 60 * 1000;

function isMcpDebugEnabled() {
  return process.env.MCP_DEBUG === "1" || process.env.MCP_DEBUG === "true";
}

function logMcpDebug(message, data) {
  if (!isMcpDebugEnabled()) {
    return;
  }
  if (data) {
    console.log("[mcp-debug]", message, JSON.stringify(data));
    return;
  }
  console.log("[mcp-debug]", message);
}

function summarizeAuthHeaders(authHeaders) {
  return Object.fromEntries(
    Object.entries(authHeaders).map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 32) : null]),
  );
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }
  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortJsonValue(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function stableJsonStringify(value) {
  return JSON.stringify(sortJsonValue(value));
}

function resolveToolAuthSpec(params) {
  if (typeof params?.name !== "string" || !isPlainObject(params.arguments)) {
    return null;
  }

  const toolArgs = params.arguments;
  if (params.name === "aiv_list_routes") {
    return { method: "GET", path: "/api/v1/runtime/routes", body: "" };
  }
  if (params.name === "aiv_get_route_details") {
    const slug = toolArgs.slug;
    if (typeof slug !== "string" || slug.length === 0) {
      return null;
    }
    return { method: "GET", path: `/api/v1/runtime/routes/${slug}`, body: "" };
  }
  if (params.name === "aiv_get_task_lineage") {
    const taskId = toolArgs.task_id;
    if (typeof taskId !== "string" || taskId.length === 0) {
      return null;
    }
    return { method: "GET", path: `/api/v1/runtime/task-context/${taskId}`, body: "" };
  }
  if (params.name === "aiv_delegate_task") {
    const targetAgent = toolArgs.target_agent;
    if (typeof targetAgent !== "string" || targetAgent.length === 0) {
      return null;
    }
    const canonicalBody = {
      target_agent: targetAgent,
      intent: toolArgs.intent,
      payload: toolArgs.payload,
      connection: toolArgs.connection,
      ...(isPlainObject(toolArgs.context) ? { context: toolArgs.context } : {}),
    };
    return {
      method: "POST",
      path: "/api/v1/a2a/send",
      body: stableJsonStringify(canonicalBody),
      targetAgentDid: targetAgent,
    };
  }
  if (params.name.startsWith("aiv_")) {
    return {
      method: "POST",
      path: `mcp/${params.name}`,
      body: stableJsonStringify(toolArgs),
    };
  }
  return null;
}

async function bodyToString(body) {
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

async function resolveRequestBody(input, init) {
  if (init?.body !== undefined) {
    return bodyToString(init.body);
  }
  if (input instanceof Request) {
    return input.clone().text();
  }
  return "";
}

function requestMethod(input, init) {
  if (typeof init?.method === "string" && init.method.length > 0) {
    return init.method.toUpperCase();
  }
  if (input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "POST";
}

function requestUrl(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function mergeHeaders(input, init, authHeaders) {
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

async function resolveAuthSpec(input, init) {
  const url = new URL(requestUrl(input));
  const method = requestMethod(input, init);
  const body = await resolveRequestBody(input, init);

  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.method === "string") {
      const paramsObject = isPlainObject(parsed.params) ? parsed.params : undefined;
      const toolName =
        parsed.method === "tools/call" && typeof paramsObject?.name === "string" ? paramsObject.name : undefined;
      logMcpDebug("outgoing rpc request", {
        rpc_method: parsed.method,
        tool_name: toolName,
      });
    }
    if (parsed?.method === "tools/call" && isPlainObject(parsed.params)) {
      const resolved = resolveToolAuthSpec(parsed.params);
      if (resolved) {
        logMcpDebug("resolved logical auth spec", {
          method: resolved.method,
          path: resolved.path,
          target_agent_did: resolved.targetAgentDid ?? null,
        });
        return resolved;
      }
    }
  } catch {
    // Fall back to raw transport request signing.
  }

  return {
    method,
    path: url.pathname || "/",
    body,
  };
}

export function createGovernanceMcpFetch() {
  let sessionAuthHeaders = null;
  let sessionStartedAtMs = 0;

  return async (input, init) => {
    const authSpec = await resolveAuthSpec(input, init);
    const nowMs = Date.now();
    const shouldCreateSession =
      sessionAuthHeaders == null || nowMs - sessionStartedAtMs >= MCP_SESSION_TTL_MS;

    if (shouldCreateSession) {
      sessionAuthHeaders = await buildMcpSessionAuthHeaders({
        method: authSpec.method,
        path: authSpec.path,
        body: authSpec.body,
        targetAgentDid: authSpec.targetAgentDid,
      });
      sessionStartedAtMs = nowMs;
      logMcpDebug("mcp auth session established", {
        method: authSpec.method,
        path: authSpec.path,
        session_ttl_ms: MCP_SESSION_TTL_MS,
      });
    }

    const authHeaders = sessionAuthHeaders;
    logMcpDebug("sending request", {
      method: authSpec.method,
      path: authSpec.path,
      mcp_session_reused: !shouldCreateSession,
      auth_header_present: typeof authHeaders.Authorization === "string",
      auth_header_prefix:
        typeof authHeaders.Authorization === "string" ? authHeaders.Authorization.slice(0, 16) : null,
      auth_envelope_mode: "authorization-bearer",
      auth_header_names: Object.keys(authHeaders),
      auth_header_values: summarizeAuthHeaders(authHeaders),
    });
    const response = await fetch(input, {
      ...init,
      headers: mergeHeaders(input, init, authHeaders),
    });
    logMcpDebug("received response", {
      status: response.status,
      ok: response.ok,
    });
    return response;
  };
}
