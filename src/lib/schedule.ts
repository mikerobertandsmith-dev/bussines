import type { Cadence, MessageType, SendFrequency } from "./types";

export const CADENCE_DAYS: Record<Cadence, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

export const FREQUENCY_DAYS: Record<SendFrequency, number> = {
  every_2_days: 2,
  daily: 1,
  weekly: 7,
  monthly: 30,
};

export function addDays(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

export function nextScanFrom(cadence: Cadence, from: Date = new Date()): string {
  return addDays(CADENCE_DAYS[cadence] ?? 1, from);
}

/**
 * Urgent alert types pull the next send forward so a price drop or competitor
 * move is never held back by a weekly schedule.
 */
export function nextSendFrom(
  frequency: SendFrequency,
  types: MessageType[] = [],
  from: Date = new Date(),
): string {
  const base = FREQUENCY_DAYS[frequency] ?? 7;
  const urgent = types.includes("competitor_alert") || types.includes("new_stock");
  return addDays(urgent ? Math.min(base, 2) : base, from);
}
