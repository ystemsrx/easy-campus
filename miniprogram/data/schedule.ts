import type { TimetableData } from "../types/api";

export type VacationLabel = "暑假" | "寒假";

export interface ScheduleColumnLayout {
  column: number;
  columnCount: number;
  leftPercent: number;
  widthPercent: number;
  leftInset: number;
  widthInset: number;
  compact: boolean;
}

interface TimelineGeometry {
  top: number;
  height: number;
}

interface PlanEndValue {
  endDate: string;
  endTime: string;
}

interface PlanStartValue {
  startDate: string;
  startTime: string;
}

const COLUMN_GAP_RPX = 8;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function shiftDate(value: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + days,
    12,
  );
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function defaultPlanEnd(
  startDate: string,
  startTime: string,
): PlanEndValue {
  const [hour, minute] = startTime.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return { endDate: startDate, endTime: startTime };
  }
  const total = hour * 60 + minute + 60;
  return {
    endDate: total >= 24 * 60 ? shiftDate(startDate, 1) : startDate,
    endTime: `${pad(Math.floor((total % (24 * 60)) / 60))}:${pad(total % 60)}`,
  };
}

export function nextWholeHour(now = new Date()): PlanStartValue {
  const next = new Date(now.getTime());
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return {
    startDate: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`,
    startTime: `${pad(next.getHours())}:00`,
  };
}

function vacationBeforeTerm(term: number): VacationLabel {
  return term === 2 ? "寒假" : "暑假";
}

function vacationAfterTerm(term: number): VacationLabel {
  return term === 1 ? "寒假" : "暑假";
}

export function vacationLabelForDate(
  timetable: TimetableData | null,
  dateKey: string,
): VacationLabel | null {
  const calendar = timetable?.semesterCalendar;
  if (timetable && calendar?.semesterId === timetable.semester.id) {
    if (dateKey < calendar.startDate) {
      return vacationBeforeTerm(timetable.semester.term);
    }
    if (dateKey > calendar.endDate) {
      return vacationAfterTerm(timetable.semester.term);
    }
  }

  const current = timetable?.currentSemester;
  if (current) {
    if (dateKey < current.startDate) {
      return vacationBeforeTerm(current.term);
    }
    if (dateKey > current.endDate) {
      return vacationAfterTerm(current.term);
    }
  }

  return null;
}

export function layoutScheduleOverlaps<T extends TimelineGeometry>(
  entries: T[],
): Array<T & ScheduleColumnLayout> {
  const sorted = entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .sort(
      (left, right) =>
        left.entry.top - right.entry.top ||
        right.entry.top +
          right.entry.height -
          (left.entry.top + left.entry.height) ||
        left.originalIndex - right.originalIndex,
    );
  const placements = new Map<number, { column: number; columnCount: number }>();
  let group: typeof sorted = [];
  let groupEnd = -1;

  const flush = () => {
    if (!group.length) return;
    const columnEnds: number[] = [];
    for (const candidate of group) {
      let column = columnEnds.findIndex((end) => end <= candidate.entry.top);
      if (column < 0) {
        column = columnEnds.length;
        columnEnds.push(0);
      }
      columnEnds[column] = candidate.entry.top + candidate.entry.height;
      placements.set(candidate.originalIndex, { column, columnCount: 0 });
    }
    for (const candidate of group) {
      const placement = placements.get(candidate.originalIndex);
      if (placement) placement.columnCount = columnEnds.length;
    }
    group = [];
  };

  for (const candidate of sorted) {
    if (group.length && candidate.entry.top >= groupEnd) {
      flush();
    }
    group.push(candidate);
    groupEnd = Math.max(groupEnd, candidate.entry.top + candidate.entry.height);
  }
  flush();

  return sorted.map(({ entry, originalIndex }) => {
    const placement = placements.get(originalIndex) || {
      column: 0,
      columnCount: 1,
    };
    const { column, columnCount } = placement;
    const isEdge = column === 0 || column === columnCount - 1;
    return {
      ...entry,
      column,
      columnCount,
      leftPercent: (column * 100) / columnCount,
      widthPercent: 100 / columnCount,
      leftInset: column === 0 ? 0 : COLUMN_GAP_RPX / 2,
      widthInset:
        columnCount === 1 ? 0 : isEdge ? COLUMN_GAP_RPX / 2 : COLUMN_GAP_RPX,
      compact: columnCount > 1,
    };
  });
}
