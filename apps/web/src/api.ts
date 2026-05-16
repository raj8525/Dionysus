export interface FlowResponse {
  nodes: unknown[];
  edges: unknown[];
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  targetRoot: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGoalInput {
  title: string;
  description: string;
  targetRoot: string;
}

const apiBase = import.meta.env.VITE_API_BASE ?? "http://localhost:23100";

export async function fetchCurrentFlow(): Promise<FlowResponse> {
  const response = await fetch(`${apiBase}/api/flow/current`);
  if (!response.ok) {
    throw new Error(`Failed to load flow: ${response.status}`);
  }
  return (await response.json()) as FlowResponse;
}

export async function createGoal(input: CreateGoalInput): Promise<Goal> {
  const response = await fetch(`${apiBase}/api/goals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  if (!response.ok) {
    throw new Error(`Failed to create goal: ${response.status}`);
  }
  return (await response.json()) as Goal;
}
