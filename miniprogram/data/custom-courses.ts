import type {
  LocalScheduleCourse,
  TimetableData,
  TimetableCourseData,
} from "../types/api";

/** Keep user courses separate from the teaching snapshot and add them only for its semester. */
export function withCustomCourses(
  timetable: TimetableData | null,
  courses: LocalScheduleCourse[],
): TimetableData | null {
  if (!timetable) return null;
  const own = courses.filter(
    (course) => course.semesterId === timetable.semester.id,
  );
  if (!own.length && !timetable.courses.some((course) => course.userAdded)) return timetable;
  const periods = new Map(
    timetable.periods.map((period) => [period.period, period]),
  );
  const custom: TimetableCourseData[] = own.flatMap((course) => {
    const selected = [...new Set(course.periods)].sort((a, b) => a - b);
    if (!selected.length || !course.weeks.length) return [];
    const groups: number[][] = [];
    selected.forEach((period) => {
      const group = groups[groups.length - 1];
      if (group && group[group.length - 1] + 1 === period) group.push(period);
      else groups.push([period]);
    });
    const weekdays = course.weekdays?.length ? [...new Set(course.weekdays)] : [course.weekday];
    return [
      {
        id: course.id,
        userAdded: true,
        excludedDates: course.excludedDates,
        courseCode: "",
        courseName: course.name,
        teachingClass: null,
        teacherNames: course.teacher ? [course.teacher] : [],
        credits: null,
        category: null,
        nature: null,
        assessmentMethod: null,
        examMethod: null,
        teachingClassComposition: [],
        retake: null,
        selectionStatus: "selected" as const,
        arrangements: weekdays.flatMap((weekday) => groups.flatMap((group, index) => {
          const first = periods.get(group[0]);
          const last = periods.get(group[group.length - 1]);
          if (!first || !last) return [];
          return [
            {
              id: `${course.id}:arrangement-${weekday}-${index}`,
              weekday,
              weekdayLabel: ["一", "二", "三", "四", "五", "六", "日"][
                weekday - 1
              ],
              periodStart: group[0],
              periodEnd: group[group.length - 1],
              periods: group,
              startTime: first.startTime,
              endTime: last.endTime,
              weekText:
                course.weeks.map((week) => `${week}`).join("、") + " 周",
              weeks: course.weeks,
              activityType: "other" as const,
              activityTypeLabel: "",
              teacherNames: course.teacher ? [course.teacher] : [],
              location: {
                campus: null,
                building: null,
                room: null,
                display: course.location,
              },
              teachingMethod: null,
              selectionStatus: "selected" as const,
              adjusted: false,
            },
          ];
        })),
      },
    ];
  });
  return {
    ...timetable,
    courses: [
      ...timetable.courses.filter((course) => !course.userAdded),
      ...custom,
    ],
  };
}
