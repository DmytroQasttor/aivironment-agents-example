from jsonschema import Draft202012Validator, FormatChecker

_format_checker = FormatChecker()

A2A_FORWARD_SCHEMA = {
    "type": "object",
    "required": ["type", "task_id", "timestamp", "source", "intent", "payload", "context"],
    "properties": {
        "type": {"const": "a2a_forward"},
        "task_id": {"type": "string", "minLength": 1},
        "timestamp": {"type": "string", "minLength": 1},
        "source": {
            "type": "object",
            "required": ["agent_id", "agent_name", "workspace_id"],
            "properties": {
                "agent_id": {"type": "string", "minLength": 1},
                "agent_name": {"type": "string", "minLength": 1},
                "workspace_id": {"type": "string", "minLength": 1},
                "workspace_name": {"type": "string", "minLength": 1},
            },
            "additionalProperties": True,
        },
        "intent": {"type": "string", "minLength": 1},
        "payload": {},
        "context": {
            "type": "object",
            "properties": {
                "correlation_id": {"type": ["string", "null"]},
                "parent_task_id": {"type": ["string", "null"]},
                "depth": {"type": ["integer", "number", "null"], "minimum": 0},
                "max_depth": {"type": ["integer", "number", "null"], "minimum": 0},
            },
            "additionalProperties": True,
        },
    },
    "additionalProperties": True,
}

OPS_AUDIT_INPUT_SCHEMA = {
    "type": "object",
    "required": ["objective", "source_task_id", "risk_focus", "severity_level"],
    "properties": {
        "objective": {"type": "string", "minLength": 1},
        "source_task_id": {"type": "string", "minLength": 1},
        "risk_focus": {"type": "string", "minLength": 1},
        "severity_level": {
            "type": "string",
            "enum": ["low", "medium", "high", "critical"],
        },
        "next_review_at": {"type": "string", "format": "date-time"},
        "requires_legal": {"type": "boolean"},
    },
    "additionalProperties": True,
}

OPS_AUDIT_OUTPUT_SCHEMA = {
    "type": "object",
    "required": ["findings", "severity", "recommendations"],
    "properties": {
        "findings": {"type": "string", "minLength": 1},
        "severity": {
            "type": "string",
            "enum": ["low", "medium", "high", "critical"],
        },
        "recommendations": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
        },
        "controls_passed": {"type": "integer", "minimum": 0},
    },
    "additionalProperties": True,
}


def _validate(schema: dict, value: dict) -> tuple[bool, list[str]]:
    validator = Draft202012Validator(schema, format_checker=_format_checker)
    errors = sorted(validator.iter_errors(value), key=lambda e: e.path)
    if not errors:
        return True, []
    return False, [
        f"{'/'.join(str(p) for p in error.path) or '/'} {error.message}"
        for error in errors
    ]


def validate_a2a_forward_envelope(value: dict) -> tuple[bool, list[str]]:
    return _validate(A2A_FORWARD_SCHEMA, value)


def validate_ops_audit_input(value: dict) -> tuple[bool, list[str]]:
    return _validate(OPS_AUDIT_INPUT_SCHEMA, value)


def validate_ops_audit_output(value: dict) -> tuple[bool, list[str]]:
    return _validate(OPS_AUDIT_OUTPUT_SCHEMA, value)
