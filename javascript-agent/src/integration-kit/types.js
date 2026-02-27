/**
 * Minimal connection payload shape for docs-oriented integration setup.
 * This intentionally avoids intent-specific validation.
 */
export function isConnectionForwardRequest(value) {
  return (
    value &&
    typeof value === "object" &&
    value.type === "a2a_forward" &&
    typeof value.task_id === "string" &&
    value.task_id.length > 0 &&
    typeof value.intent === "string" &&
    value.intent.length > 0
  );
}

