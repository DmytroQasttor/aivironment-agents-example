import { mcpCallTool } from "../mcp/mcpClientHttp.js";

export const PLATFORM_MCP_TOOLS = {
  getTaskContext: "get_task_context",
  listReachableRoutes: "list_reachable_routes",
  getRouteDetails: "get_route_details",
  delegateTask: "delegate_task",
};

/**
 * Minimal MCP tool wrapper set for docs.
 */
export const mcpToolkit = {
  getTaskContext(taskId, maxParentDepth) {
    return mcpCallTool(PLATFORM_MCP_TOOLS.getTaskContext, {
      task_id: taskId,
      ...(typeof maxParentDepth === "number" ? { max_parent_depth: maxParentDepth } : {}),
    });
  },
  listReachableRoutes(taskId, page, perPage) {
    return mcpCallTool(PLATFORM_MCP_TOOLS.listReachableRoutes, {
      task_id: taskId,
      ...(typeof page === "number" ? { page } : {}),
      ...(typeof perPage === "number" ? { per_page: perPage } : {}),
    });
  },
  getRouteDetails(taskId, slug) {
    return mcpCallTool(PLATFORM_MCP_TOOLS.getRouteDetails, {
      task_id: taskId,
      slug,
    });
  },
  delegateTask({ taskId, connection, targetAgentDid, intent, payload, context }) {
    return mcpCallTool(
      PLATFORM_MCP_TOOLS.delegateTask,
      {
        task_id: taskId,
        connection,
        target_agent: targetAgentDid,
        intent,
        payload,
        context: context ?? {},
      },
      targetAgentDid,
    );
  },
};

