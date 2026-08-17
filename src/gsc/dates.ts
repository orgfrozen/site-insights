export interface DatePeriod {
  startDate: string;
  endDate: string;
}

export interface ComparisonPeriods {
  last7: DatePeriod;
  previous7: DatePeriod;
  last28: DatePeriod;
  previous28: DatePeriod;
}

const pacificFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDateOnly(value: string): Date {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    throw new Error("invalid_date");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("invalid_date");
  }

  return date;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function formatSearchConsoleDate(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error("invalid_date");
  }

  const parts = pacificFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error("invalid_date");
  }

  return `${year}-${month}-${day}`;
}

export function subtractDays(value: string, days: number): string {
  if (!Number.isInteger(days) || days < 0) {
    throw new Error("invalid_days");
  }

  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() - days);
  return formatDateOnly(date);
}

export function periodEndingOn(endDate: string, days: number): DatePeriod {
  if (!Number.isInteger(days) || days <= 0) {
    throw new Error("invalid_period_days");
  }

  parseDateOnly(endDate);
  return {
    startDate: subtractDays(endDate, days - 1),
    endDate,
  };
}

export function comparisonPeriods(latestFinalDate: string): ComparisonPeriods {
  parseDateOnly(latestFinalDate);

  const previous7End = subtractDays(latestFinalDate, 7);
  const previous28End = subtractDays(latestFinalDate, 28);

  return {
    last7: periodEndingOn(latestFinalDate, 7),
    previous7: periodEndingOn(previous7End, 7),
    last28: periodEndingOn(latestFinalDate, 28),
    previous28: periodEndingOn(previous28End, 28),
  };
}
