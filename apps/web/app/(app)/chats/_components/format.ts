// Shared timestamp formatting for the chat UI. Kept tiny + dependency-free.

const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Relative-ish label for a conversation row: time today, weekday this week, else a date. */
export function formatChatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (dayDiff <= 0) return TIME.format(date);
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return WEEKDAY.format(date);
  return SHORT_DATE.format(date);
}

/** Clock time for a single message bubble. */
export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return TIME.format(date);
}

/** Section divider label, e.g. "Today", "Yesterday", "Mar 3". */
export function formatDayDivider(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (dayDiff <= 0) return "Today";
  if (dayDiff === 1) return "Yesterday";
  return SHORT_DATE.format(date);
}
