/** How long ago `iso` was, short: "now", "5 min", "3 h", "2 d", or the date after a month. */
export function ago(iso: string, now: Date): string {
  const then = new Date(iso);
  const seconds = Math.max(0, (now.getTime() - then.getTime()) / 1000);
  if (Number.isNaN(seconds)) return iso;
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h`;
  if (seconds < 30 * 86_400) return `${Math.floor(seconds / 86_400)} d`;
  return iso.slice(0, 10);
}
