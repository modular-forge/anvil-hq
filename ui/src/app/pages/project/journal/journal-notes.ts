// Journal notes as the board shows them: one day per note file, entries under "## HH:MM"
// headings, newest first.

export interface JournalEntry {
  time: string;
  text: string;
}

export interface JournalDay {
  date: string;
  entries: JournalEntry[];
}

const HEADING = /^## (\d{1,2}:\d{2})\s*$/;

/** The entries of one note, newest first. Text before the first heading becomes an untimed entry. */
export function parseNote(text: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  let current: JournalEntry = { time: '', text: '' };
  for (const line of text.replaceAll('\r\n', '\n').split('\n')) {
    const heading = HEADING.exec(line);
    if (heading?.[1]) {
      if (current.text.trim()) entries.push(current);
      current = { time: heading[1], text: '' };
    } else {
      current.text += `${line}\n`;
    }
  }
  if (current.text.trim()) entries.push(current);
  return entries.map((e) => ({ time: e.time, text: e.text.trim() })).reverse();
}

/** "Today", "Yesterday", the weekday within a week, or the date. */
export function dayLabel(date: string, now: Date): string {
  const day = new Date(`${date}T00:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return day.toLocaleDateString('en-GB', { weekday: 'long' });
  return date;
}

/** YYYY-MM-DD in local time, as the server names note files. */
export function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
