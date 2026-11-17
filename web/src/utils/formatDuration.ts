/**
 * Format minutes for display
 * 45 -> "45 mins" 60 -> "1hr", 90 -> 1 hr 30min, etc...
 */

export function formatDuration(totalMinutes: number): string {
    const hour = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60;

    if (hour === 0) return `${minutes} min`;
    if (minutes === 0) return `${hour} hr`;
    return `${hour} hr ${minutes} min`;
}
