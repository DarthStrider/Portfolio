/** The shapes the API returns (Snack 2's model, serialized in camelCase with enums as text). */
export type EventKind = "BadgeSwipe" | "StatusChange";

export interface AccessEvent {
  id: number;
  occurredAtUtc: string;
  deviceId: number;
  deviceName: string;
  location: string;
  cardholderId: number | null;
  cardholderName: string | null;
  kind: EventKind;
  granted: boolean | null;
  detail: string | null;
  outcome: string;
}

export interface DeniedByDoorRow {
  deviceId: number;
  deviceName: string;
  location: string;
  denied: number;
}

export interface NoisyDeviceRow {
  deviceId: number;
  deviceName: string;
  kind: "Door" | "Camera";
  events: number;
}

export type Outcome = "all" | "granted" | "denied" | "status";
