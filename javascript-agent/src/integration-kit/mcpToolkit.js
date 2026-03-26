import { mcpCallTool } from "../mcp/mcpClientHttp.js";

export const PLATFORM_MCP_TOOLS = {
  identify: "aiv_identify",
  checkAction: "aiv_check_action",
  logActivity: "aiv_log_activity",
  heartbeat: "aiv_heartbeat",
  complianceRules: "aiv_compliance_rules",
  pollTasks: "aiv_poll_tasks",
  completeTask: "aiv_complete_task",
  discoverAgents: "aiv_discover_agents",
  platformStats: "aiv_platform_stats",
  sendMessage: "aiv_send_message",
  getRateLimitStatus: "aiv_get_rate_limit_status",
  getMyConnections: "aiv_get_my_connections",
  requestConnection: "aiv_request_connection",
  rotateSecret: "aiv_rotate_secret",
  getTaskDetails: "aiv_get_task_details",
  getMyMetrics: "aiv_get_my_metrics",
  updateMyMetadata: "aiv_update_my_metadata",
  testConnection: "aiv_test_connection",
  getComplianceEvidence: "aiv_get_compliance_evidence",
  storeData: "aiv_store_data",
  retrieveData: "aiv_retrieve_data",
  emergencyShutdown: "aiv_emergency_shutdown",
  getMyActivity: "aiv_get_my_activity",
  getTaskLineage: "aiv_get_task_lineage",
  listRoutes: "aiv_list_routes",
  getRouteDetails: "aiv_get_route_details",
  acceptTask: "aiv_accept_task",
  delegateTask: "aiv_delegate_task",
};

/**
 * Minimal MCP tool wrapper set for docs.
 */
export const mcpToolkit = {
  callTool(name, args, targetAgentDid) {
    return mcpCallTool(name, args, targetAgentDid);
  },
  getTaskLineage(taskId, maxParentDepth) {
    return mcpCallTool(PLATFORM_MCP_TOOLS.getTaskLineage, {
      task_id: taskId,
      ...(typeof maxParentDepth === "number" ? { max_parent_depth: maxParentDepth } : {}),
    });
  },
  listRoutes(taskId, page, perPage) {
    return mcpCallTool(PLATFORM_MCP_TOOLS.listRoutes, {
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
