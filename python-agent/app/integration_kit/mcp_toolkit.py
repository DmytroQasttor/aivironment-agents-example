from typing import Any

from app.mcp_client import mcp_call_tool

PLATFORM_MCP_TOOLS = {
    "get_task_context": "get_task_context",
    "list_reachable_routes": "list_reachable_routes",
    "get_route_details": "get_route_details",
    "delegate_task": "delegate_task",
}


class _McpToolkit:
    """Thin MCP wrappers for docs-focused endpoint integration."""

    @staticmethod
    def get_task_context(task_id: str, max_parent_depth: int | None = None) -> Any:
        return mcp_call_tool(
            PLATFORM_MCP_TOOLS["get_task_context"],
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
    def list_reachable_routes(
        task_id: str,
        page: int | None = None,
        per_page: int | None = None,
    ) -> Any:
        return mcp_call_tool(
            PLATFORM_MCP_TOOLS["list_reachable_routes"],
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

