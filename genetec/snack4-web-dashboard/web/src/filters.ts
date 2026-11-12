import type { AccessEvent, Outcome } from "./types";

export const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "granted", label: "Granted" },
  { value: "denied", label: "Denied" },
  { value: "status", label: "Status changes" },
];

/** The query string for /api/events. Defaults are left out, so the URL stays short. */
export function eventsQuery(outcome: Outcome, search: string, limit = 100): string {
  const params = new URLSearchParams();
  if (outcome !== "all") params.set("outcome", outcome);
  const text = search.trim();
  if (text) params.set("search", text);
  if (limit !== 100) params.set("limit", String(limit));
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** "granted", "denied" or "status": used as the row's CSS class for its colour. */
export function tone(event: AccessEvent): "granted" | "denied" | "status" {
  if (event.granted === true) return "granted";
  if (event.granted === false) return "denied";
  return "status";
}

/** "just now", "5 min ago", "3 h ago", or the date for anything older than a day. */
export function relativeTime(isoUtc: string, now: Date): string {
  const then = new Date(isoUtc.endsWith("Z") ? isoUtc : `${isoUtc}Z`);
  const seconds = Math.round((now.getTime() - then.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return then.toISOString().slice(0, 10);
}
