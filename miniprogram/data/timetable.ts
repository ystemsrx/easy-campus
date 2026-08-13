export interface TimetableCourse {
  id: string;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  startTime: string;
  endTime: string;
  periodLabel: string;
  name: string;
  teacher: string;
  location: string;
  tone: "blue" | "cyan" | "purple" | "green" | "orange";
}

// 占位数据：后续课表 API 完善后，仅需替换该数据源。
export const TIMETABLE_PLACEHOLDER: TimetableCourse[] = [
  {
    id: "mon-data-structure",
    weekday: 1,
    startTime: "08:00",
    endTime: "09:40",
    periodLabel: "1–2 节",
    name: "数据结构",
    teacher: "陈老师",
    location: "25 教 301",
    tone: "blue",
  },
  {
    id: "mon-college-english",
    weekday: 1,
    startTime: "10:00",
    endTime: "11:40",
    periodLabel: "3–4 节",
    name: "大学英语",
    teacher: "王老师",
    location: "31 教 204",
    tone: "cyan",
  },
  {
    id: "mon-database",
    weekday: 1,
    startTime: "14:00",
    endTime: "15:40",
    periodLabel: "7–8 节",
    name: "数据库原理",
    teacher: "李老师",
    location: "工科大楼 B 座 402",
    tone: "purple",
  },
  {
    id: "mon-innovation-practice",
    weekday: 1,
    startTime: "19:20",
    endTime: "21:00",
    periodLabel: "12–13 节",
    name: "创新实践",
    teacher: "黄老师",
    location: "软件学院实验室 2",
    tone: "green",
  },
  {
    id: "tue-computer-network",
    weekday: 2,
    startTime: "08:55",
    endTime: "10:45",
    periodLabel: "2–3 节",
    name: "计算机网络",
    teacher: "周老师",
    location: "32 教 208",
    tone: "green",
  },
  {
    id: "tue-physical-education",
    weekday: 2,
    startTime: "15:50",
    endTime: "17:40",
    periodLabel: "9–10 节",
    name: "大学体育",
    teacher: "刘老师",
    location: "第一运动场",
    tone: "orange",
  },
  {
    id: "tue-project-workshop",
    weekday: 2,
    startTime: "19:20",
    endTime: "21:00",
    periodLabel: "12–13 节",
    name: "项目实践工作坊",
    teacher: "郑老师",
    location: "创新创业中心 201",
    tone: "blue",
  },
  {
    id: "wed-operating-system",
    weekday: 3,
    startTime: "10:00",
    endTime: "11:40",
    periodLabel: "3–4 节",
    name: "操作系统",
    teacher: "赵老师",
    location: "25 教 208",
    tone: "purple",
  },
  {
    id: "wed-software-engineering",
    weekday: 3,
    startTime: "14:00",
    endTime: "15:40",
    periodLabel: "7–8 节",
    name: "软件工程",
    teacher: "张老师",
    location: "工科大楼 A 座 312",
    tone: "blue",
  },
  {
    id: "wed-academic-writing",
    weekday: 3,
    startTime: "19:20",
    endTime: "21:00",
    periodLabel: "12–13 节",
    name: "学术写作",
    teacher: "徐老师",
    location: "31 教 305",
    tone: "cyan",
  },
  {
    id: "thu-probability",
    weekday: 4,
    startTime: "08:00",
    endTime: "09:40",
    periodLabel: "1–2 节",
    name: "概率论与数理统计",
    teacher: "杨老师",
    location: "33 教 101",
    tone: "cyan",
  },
  {
    id: "thu-web-development",
    weekday: 4,
    startTime: "12:10",
    endTime: "13:50",
    periodLabel: "5–6 节",
    name: "Web 应用开发",
    teacher: "吴老师",
    location: "软件学院实验室 3",
    tone: "green",
  },
  {
    id: "thu-open-source-practice",
    weekday: 4,
    startTime: "19:20",
    endTime: "21:00",
    periodLabel: "12–13 节",
    name: "开源软件实践",
    teacher: "罗老师",
    location: "软件学院实验室 4",
    tone: "purple",
  },
  {
    id: "fri-algorithm",
    weekday: 5,
    startTime: "10:55",
    endTime: "12:55",
    periodLabel: "4–5 节",
    name: "算法设计与分析",
    teacher: "孙老师",
    location: "30 教 406",
    tone: "orange",
  },
  {
    id: "fri-mobile-development",
    weekday: 5,
    startTime: "14:55",
    endTime: "16:35",
    periodLabel: "8–9 节",
    name: "移动应用开发",
    teacher: "何老师",
    location: "软件学院实验室 1",
    tone: "blue",
  },
  {
    id: "fri-career-planning",
    weekday: 5,
    startTime: "19:20",
    endTime: "21:00",
    periodLabel: "12–13 节",
    name: "职业生涯规划",
    teacher: "唐老师",
    location: "学生就业指导中心",
    tone: "orange",
  },
];

export function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function currentMinutes(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function currentIsoWeekday(
  date = new Date(),
): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return (date.getDay() || 7) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export function formatClock(date = new Date()): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function coursesForWeekday(weekday: number): TimetableCourse[] {
  return TIMETABLE_PLACEHOLDER.filter(
    (course) => course.weekday === weekday,
  ).sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
}

export function remainingCourses(date = new Date()): TimetableCourse[] {
  const now = currentMinutes(date);
  return coursesForWeekday(currentIsoWeekday(date)).filter(
    (course) => timeToMinutes(course.endTime) > now,
  );
}

export interface CoursePreviewSelection {
  courses: TimetableCourse[];
  currentCourseId: string | null;
}

export function coursePreview(
  date = new Date(),
  limit = 3,
): CoursePreviewSelection {
  const minutes = currentMinutes(date);
  const remaining = remainingCourses(date);
  const currentCourse = remaining.find(
    (course) =>
      minutes >= timeToMinutes(course.startTime) &&
      minutes < timeToMinutes(course.endTime),
  );
  const safeLimit = Math.max(0, Math.floor(limit));
  const courses = currentCourse
    ? [
        currentCourse,
        ...remaining
          .filter((course) => course.id !== currentCourse.id)
          .slice(0, Math.max(0, safeLimit - 1)),
      ]
    : remaining.slice(0, safeLimit);

  return {
    courses: courses.slice(0, safeLimit),
    currentCourseId: currentCourse?.id ?? null,
  };
}
