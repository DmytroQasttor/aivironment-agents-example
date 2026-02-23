export type Priority = "low" | "medium" | "high" | "critical";

export interface OpsCoordinatePayload {
  objective: string;
  priority: Priority;
  constraints: string[];
  metadata: {
    owner: string;
    region: string;
    risk_score: number;
  };
  mode?: {
    name?: string;
    version?: number;
  };
  due_date?: string;
  iteration?: number;
  budget_limit?: number;
}

export interface A2AForwardRequest {
  type: "a2a_forward";
  task_id: string;
  timestamp: string;
  source: {
    agent_id: string;
    agent_name: string;
    workspace_id: string;
    workspace_name: string;
  };
  intent: string;
  payload: unknown;
  context: {
    project_id: string | null;
    correlation_id: string;
    depth: number;
    max_depth: number;
    parent_task_id: string | null;
  };
}

export interface OpsCoordinateResult {
  plan: string;
  actions: Array<Record<string, unknown>>;
  score?: number;
}
