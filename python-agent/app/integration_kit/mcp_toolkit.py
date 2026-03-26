from typing import Any

from app.mcp_client import mcp_call_tool

PLATFORM_MCP_TOOLS = {
    "identify": "aiv_identify",
    "check_action": "aiv_check_action",
    "log_activity": "aiv_log_activity",
    "heartbeat": "aiv_heartbeat",
    "compliance_rules": "aiv_compliance_rules",
    "poll_tasks": "aiv_poll_tasks",
    "complete_task": "aiv_complete_task",
    "discover_agents": "aiv_discover_agents",
    "platform_stats": "aiv_platform_stats",
    "send_message": "aiv_send_message",
    "get_rate_limit_status": "aiv_get_rate_limit_status",
    "get_my_connections": "aiv_get_my_connections",
    "request_connection": "aiv_request_connection",
    "rotate_secret": "aiv_rotate_secret",
    "get_task_details": "aiv_get_task_details",
    "get_my_metrics": "aiv_get_my_metrics",
    "update_my_metadata": "aiv_update_my_metadata",
    "test_connection": "aiv_test_connection",
    "get_compliance_evidence": "aiv_get_compliance_evidence",
    "store_data": "aiv_store_data",
    "retrieve_data": "aiv_retrieve_data",
    "emergency_shutdown": "aiv_emergency_shutdown",
    "get_my_activity": "aiv_get_my_activity",
    "get_task_lineage": "aiv_get_task_lineage",
    "list_routes": "aiv_list_routes",
    "get_route_details": "aiv_get_route_details",
    "accept_task": "aiv_accept_task",
    "delegate_task": "aiv_delegate_task",
}


class _McpToolkit:
    """Thin MCP wrappers for docs-focused endpoint integration."""

    @staticmethod
    def call_tool(
        name: str, args: dict[str, Any], target_agent_did: str | None = None
    ) -> Any:
        return mcp_call_tool(name, args, target_agent_did=target_agent_did)

    @staticmethod
    def get_task_lineage(task_id: str, max_parent_depth: int | None = None) -> Any:
        return mcp_call_tool(
            PLATFORM_MCP_TOOLS["get_task_lineage"],
            {
                "task_id": task_id,
                **(
                    {"max_parent_depth": max_parent_depth}
                    if isinstance(max_parent_depth, (int, float))
                    else {}
                ),
            },
        )

    @staticmethod
    def list_routes(
        task_id: str,
        page: int | None = None,
        per_page: int | None = None,
    ) -> Any:
        return mcp_call_tool(
            PLATFORM_MCP_TOOLS["list_routes"],
            {
                "task_id": task_id,
                **({"page": page} if isinstance(page, (int, float)) else {}),
                **({"per_page": per_page} if isinstance(per_page, (int, float)) else {}),
            },
        )

    @staticmethod
    def get_route_details(task_id: str, slug: str) -> Any:
        return mcp_call_tool(
            PLATFORM_MCP_TOOLS["get_route_details"],
            {
                "task_id": task_id,
                "slug": slug,
            },
        )

    @staticmethod
    def delegate_task(
        task_id: str,
        connection: str,
        target_agent_did: str,
        intent: str,
        payload: dict[str, Any],
        context: dict[str, Any] | None = None,
    ) -> Any:
        return mcp_call_tool(
            PLATFORM_MCP_TOOLS["delegate_task"],
            {
                "task_id": task_id,
                "connection": connection,
                "target_agent": target_agent_did,
                "intent": intent,
                "payload": payload,
                "context": context or {},
            },
            target_agent_did=target_agent_did,
        )


mcp_toolkit = _McpToolkit()
