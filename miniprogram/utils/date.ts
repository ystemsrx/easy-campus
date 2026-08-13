const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
// 教务系统的无偏移时间是校园当地时间；这里只补全来源偏移，展示始终使用设备时区。
const SWU_SOURCE_OFFSET = "+08:00";
const MESSAGE_WEEKDAYS = [
  "",
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
  "周日",
];

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

function parseTimestamp(value: string): Date | null {
  const explicitZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value);
  const plain = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(
    value,
  );
  const normalized =
    !explicitZone && plain
      ? `${plain[1]}-${plain[2]}-${plain[3]}T${plain[4]}:${plain[5]}:${plain[6] || "00"}${SWU_SOURCE_OFFSET}`
      : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function today(): string {
  return toDateString(new Date());
}

export function currentLocalHour(): number {
  return new Date().getHours();
}

export function formatFriendlyDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    return value;
  }

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return `${Number(match[2])}月${Number(match[3])}日 ${WEEKDAYS[date.getDay()]}`;
}

export function formatShortDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${Number(match[2])}月${Number(match[3])}日` : value;
}

export function formatDateTime(value: string): string {
  const parsed = parseTimestamp(value);
  if (!parsed) return value;
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日 ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

export function formatTimestampDate(value: string): string {
  const parsed = parseTimestamp(value);
  if (!parsed) return value;
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日 ${WEEKDAYS[parsed.getDay()]}`;
}

export function formatTimestampTime(value: string): string {
  const parsed = parseTimestamp(value);
  if (!parsed) return value;
  return `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

export function localDateKey(value: string): string {
  const parsed = parseTimestamp(value);
  return parsed ? toDateString(parsed) : "";
}

export function formatMessageWeekday(value: number): string {
  return MESSAGE_WEEKDAYS[value] || `周${value}`;
}

export function getDefaultAcademicPeriod(): {
  academicYear: number;
  term: 1 | 2 | 3;
} {
  const [year, month] = today().split("-").map(Number);

  if (month >= 8) {
    return { academicYear: year, term: 1 };
  }
  if (month === 7) {
    return { academicYear: year - 1, term: 3 };
  }
  return { academicYear: year - 1, term: 2 };
}

export function academicYearLabel(startYear: number): string {
  return `${startYear}-${startYear + 1}`;
}
