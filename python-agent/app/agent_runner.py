from app.agents.ops_audit import run_ops_audit
from app.errors import AgentError


def run_agent(task: dict) -> dict:
    intent = task.get("intent")
    if intent == "ops.audit":
        return run_ops_audit(task)
    raise AgentError("INTENT_UNSUPPORTED", f"Unsupported intent: {intent}", False, 400)
