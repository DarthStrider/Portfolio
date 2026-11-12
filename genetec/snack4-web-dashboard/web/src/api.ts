import { eventsQuery } from "./filters";
import type { AccessEvent, DeniedByDoorRow, NoisyDeviceRow, Outcome } from "./types";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  events: (outcome: Outcome, search: string) => get<AccessEvent[]>(`/events${eventsQuery(outcome, search)}`),
  deniedByDoor: () => get<DeniedByDoorRow[]>("/reports/denied-by-door"),
  noisiest: () => get<NoisyDeviceRow[]>("/reports/noisiest"),
  health: () => get<{ status: string; store: string }>("/health"),
};
