import { mcpCallTool } from "../mcp/mcpClientHttp";

export const PLATFORM_MCP_TOOLS = {
  getTaskContext: "get_task_context",
  listReachableRoutes: "list_reachable_routes",
  getRouteDetails: "get_route_details",
  delegateTask: "delegate_task",
} as const;

/**
 * Minimal helper API for platform MCP tools.
 * These wrappers are intentionally thin so documentation users can see exactly:
 * - tool names
 * - required inputs
 * - expected output source (MCP result object)
 */
export const mcpToolkit = {
  getTaskContext(taskId: string, maxParentDepth?: number) {
    return mcpCallTool(PLATFORM_MCP_TOOLS.getTaskContext, {
      task_id: taskId,
      ...(typeof maxParentDepth === "number" ? { max_parent_depth: maxParentDepth } : {}),
    });
  },
  listReachableRoutes(taskId: string, page?: number, perPage?: number) {
    return mcpCallTool(PLATFORM_MCP_TOOLS.listReachableRoutes, {
      task_id: taskId,
      ...(typeof page === "number" ? { page } : {}),
      ...(typeof perPage === "number" ? { per_page: perPage } : {}),
    });
  },
  getRouteDetails(taskId: string, slug: string) {
    return mcpCallTool(PLATFORM_MCP_TOOLS.getRouteDetails, {
      task_id: taskId,
      slug,
    });
  },
  delegateTask(params: {
    taskId: string;
    connection: string;
    targetAgentDid: string;
    intent: string;
    payload: Record<string, unknown>;
    context?: Record<string, unknown>;
  }) {
    return mcpCallTool(
      PLATFORM_MCP_TOOLS.delegateTask,
      {
        task_id: params.taskId,
        connection: params.connection,
        target_agent: params.targetAgentDid,
        intent: params.intent,
        payload: params.payload,
        context: params.context ?? {},
      },
      params.targetAgentDid,
    );
  },
};

