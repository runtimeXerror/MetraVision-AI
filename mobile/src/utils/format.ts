/**
 * Formatting helpers.
 *
 * Everything here is pure and dependency-free so the same file can move into
 * `shared/` in Phase 2 and be reused verbatim by the web dashboard.
 */

/** Indexed by `Date.getDay()`, so Sunday is 0 — the order JavaScript uses. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

function toDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `30 Aug 2026` */
export function formatDate(value?: string | Date | null): string {
  if (!value) return '—';
  const date = toDate(value);
  if (!date) return '—';
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** `30 Aug` — the year is dropped for axis ticks, where it repeats on every label. */
export function formatShortDate(value?: string | Date | null): string {
  if (!value) return '—';
  const date = toDate(value);
  if (!date) return '—';
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** `14:32` */
export function formatTime(value?: string | Date | null): string {
  if (!value) return '—';
  const date = toDate(value);
  if (!date) return '—';
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * The 12-hour value and meridiem for a 24-hour hour.
 *
 * Noon and midnight are the two a naive `% 12` gets wrong, printing "0:15 AM"
 * for a quarter past midnight and "0:00 PM" for noon.
 */
function to12Hour(hours24: number): { hour: number; meridiem: 'AM' | 'PM' } {
  return {
    hour: hours24 % 12 === 0 ? 12 : hours24 % 12,
    meridiem: hours24 < 12 ? 'AM' : 'PM',
  };
}

/**
 * `2:32:07 PM` — a running clock.
 *
 * Seconds are the whole point: a time that changes is how a display says it is
 * live rather than stamped. Minutes and seconds are zero-padded so those four
 * digit positions are always occupied; the hour is not, because "02:32:07 PM"
 * is not how anyone writes a 12-hour time, and the hour changes once an hour
 * rather than once a second.
 */
export function formatClock(value?: string | Date | null): string {
  if (!value) return '—';
  const date = toDate(value);
  if (!date) return '—';

  const { hour, meridiem } = to12Hour(date.getHours());
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const seconds = `${date.getSeconds()}`.padStart(2, '0');

  return `${hour}:${minutes}:${seconds} ${meridiem}`;
}

/**
 * `30 Aug 2026, 2:32 PM`
 *
 * The 12-hour clock, matching the inspection cards and the running clock on the
 * capture screen. It reads a stamp aloud the way an officer would say it, and
 * it is what appears on the printed report — where "14:32" against a date is
 * the one place a reader has to do a conversion.
 *
 * The 24-hour `formatTime` is still used on its own for capture timestamps,
 * where an unambiguous ordering matters more than familiarity.
 */
export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const date = toDate(value);
  if (!date) return '—';
  return `${formatDate(date)}, ${formatTime12(date)}`;
}

/** `2h ago`, `Just now`, `3 days ago` */
export function formatRelative(value?: string | Date | null, now: Date = new Date()): string {
  if (!value) return '—';
  const date = toDate(value);
  if (!date) return '—';

  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  return formatDate(date);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `2:30 PM` — the 12-hour clock, which is how time is read aloud in the field.
 *
 * Kept beside the 24-hour `formatTime` rather than replacing it: the inspection
 * detail screen stamps a capture in 24-hour time, where an unambiguous ordering
 * matters more than familiarity.
 */
export function formatTime12(value?: string | Date | null): string {
  if (!value) return '—';
  const date = toDate(value);
  if (!date) return '—';

  const { hour, meridiem } = to12Hour(date.getHours());
  const minutes = `${date.getMinutes()}`.padStart(2, '0');

  return `${hour}:${minutes} ${meridiem}`;
}

/** Whether two instants fall on the same calendar day, in local time. */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * `Today, 2:30 PM` · `Yesterday, 11:45 PM` · `28 Aug, 2:30 PM` · `29 Jul 2025, 6:10 AM`.
 *
 * The timestamp for a record in a list, as distinct from `formatRelative`,
 * which is the right shape for something that just happened — an image
 * captured moments ago reads better as "2m ago" than as a clock time.
 *
 * The time is always shown, whatever the day. An inspection is a timed
 * enforcement act: "28 Aug" answers which day an officer attended and not when,
 * and when is the half that matters for a shift record or a dispute about it.
 *
 * The day turns on the **calendar day**, not on a rolling 24-hour window, and
 * the two are not the same thing. At one in the morning, an inspection filed at
 * eleven the previous night is inside 24 hours but it is emphatically not
 * "Today" — an officer reading that would place it in the wrong shift. Anything
 * within the last day therefore lands on Today or Yesterday, and both say which.
 *
 * The year appears only when it is not the current one. Printing "2026" on
 * every row of a list an officer fills this year is four characters of noise on
 * a card that also carries a reference, a business and two counts — but a
 * record from a previous year has to say so, or it is silently misread.
 */
export function formatTimeOrDate(value?: string | Date | null, now: Date = new Date()): string {
  const { day, time } = timestampParts(value, now);
  return time ? `${day}, ${time}` : day;
}

export interface TimestampParts {
  /** `Today` · `Yesterday` · `31 Aug, Wed` · `29 Jul 2025, Tue`. */
  day: string;
  /** `2:30 PM`. Empty only when there was no usable date. */
  time: string;
}

/**
 * The same stamp split in two, for a card that sets the day over the time.
 *
 * Two lines rather than one because the two answer different questions and are
 * scanned at different moments: an officer runs down a list looking for a day,
 * and only reads the time once they have found the row. Stacked, the days form
 * a column the eye can run; strung together on one line they do not.
 *
 * The weekday is carried on the date — "31 Aug, Wed" — because a shift is
 * remembered by the day of the week far more readily than by the date, and it
 * costs three characters to say.
 */
export function timestampParts(
  value?: string | Date | null,
  now: Date = new Date(),
): TimestampParts {
  if (!value) return { day: '—', time: '' };
  const date = toDate(value);
  if (!date) return { day: '—', time: '' };

  const time = formatTime12(date);

  // A record stamped slightly ahead — the device clock trailing the server's —
  // is still today's, and reads correctly without a special case.
  if (isSameDay(date, now)) return { day: 'Today', time };

  const yesterday = new Date(now);
  // `setDate` rolls the month and year over on its own, so the last day of a
  // month and 1 January need no handling of their own.
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return { day: 'Yesterday', time };

  const stamp =
    date.getFullYear() === now.getFullYear() ? formatShortDate(date) : formatDate(date);

  return { day: `${stamp}, ${WEEKDAYS[date.getDay()]}`, time };
}

/** `₹120.00` — always two decimals, grouped in the Indian numbering system. */
export function formatCurrency(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';

  const fixed = Math.abs(value).toFixed(2);
  const [whole = '0', decimals = '00'] = fixed.split('.');

  // Indian grouping: last three digits, then pairs (12,34,567).
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}` : lastThree;

  return `${value < 0 ? '-' : ''}₹${grouped}.${decimals}`;
}

/** `96%` from `0.96`. */
export function formatConfidence(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

/** `1.2 MB` */
export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / 1024 ** exponent;
  return `${size < 10 && exponent > 0 ? size.toFixed(1) : Math.round(size)} ${units[exponent]}`;
}

/** `1.4s` / `840ms` */
export function formatDuration(ms?: number | null): string {
  if (ms === null || ms === undefined || ms < 0) return '—';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** `RS` from `Ravi Sharma` — used by the avatar monogram. */
export function initials(name?: string | null): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** `Good morning` / `Good afternoon` / `Good evening` */
export function greetingFor(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Truncates without cutting mid-word where it can be avoided. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
