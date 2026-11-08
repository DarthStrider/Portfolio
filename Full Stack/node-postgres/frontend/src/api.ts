export interface Task {
  id: number;
  title: string;
  done: boolean;
  createdAt: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  list: () => request<Task[]>("/tasks"),
  create: (title: string) =>
    request<Task>("/tasks", { method: "POST", body: JSON.stringify({ title }) }),
  update: (id: number, changes: Partial<Pick<Task, "title" | "done">>) =>
    request<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(changes) }),
  remove: (id: number) => request<void>(`/tasks/${id}`, { method: "DELETE" }),
  info: () => request<{ hostname: string }>("/info"),
};
