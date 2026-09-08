import type {
  AcademicSemesterOption,
  AutoDormCheckStatus,
  CalendarData,
  CurrentUserData,
  ElectricityCachedData,
  ExamsData,
  GradeCourse,
  GradesData,
  LocalScheduleData,
  NoticeDetail,
  PassRatesData,
  RoomOptionsData,
  RoomsData,
  TeachingMessage,
  TimetableData,
} from "../types/api";
import { toDateString } from "../utils/date";

/** Calendar arithmetic uses the viewer's local day, including DST boundaries. */
export function demoDate(offset = 0, now = new Date()): string {
  return toDateString(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset),
  );
}

export function demoTimestamp(offset = 0, hour = 9): string {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + offset,
    hour,
  ).toISOString();
}

export function demoSemester(): AcademicSemesterOption {
  const now = new Date();
  const academicYear = now.getFullYear() - (now.getMonth() < 8 ? 1 : 0);
  const term = now.getMonth() >= 1 && now.getMonth() < 8 ? 2 : 1;
  const academicYearLabel = `${academicYear}-${academicYear + 1}`;
  return {
    id: `${academicYear}-${term}`,
    academicYear,
    academicYearLabel,
    term,
    label: `${academicYearLabel} 第${term === 1 ? "一" : "二"}学期`,
  };
}

export function demoUser(): CurrentUserData {
  const year = demoSemester().academicYear - 1;
  return {
    id: "demo-local",
    account: "demo",
    name: "同学",
    registeredAt: demoTimestamp(-60),
    credential: {
      status: "verified",
      checkedAt: new Date().toISOString(),
      errorCode: null,
    },
    companion: null,
    profile: {
      gender: "",
      grade: `${year}级`,
      organizationName: "计算机与信息科学学院",
      className: "计算机科学与技术1班",
      enrollmentDate: `${year}-09-01`,
    },
  };
}

export const DEMO_COURSES = [
  "高等数学",
  "大学英语",
  "程序设计基础",
  "中国文化概论",
  "大学体育",
];
const TEACHERS = ["张老师", "李老师", "王老师", "陈老师", "刘老师"];

export function demoTimetable(): TimetableData {
  const semester = demoSemester();
  // Always place today in week four, even during vacations or many years later.
  const mondayOffset = -((new Date().getDay() + 6) % 7) - 21;
  const weeks = Array.from({ length: 20 }, (_, i) => ({
    weekNumber: i + 1,
    startDate: demoDate(mondayOffset + i * 7),
    endDate: demoDate(mondayOffset + i * 7 + 6),
  }));
  const periodTimes = [
    ["08:00", "08:45"],
    ["08:55", "09:40"],
    ["10:00", "10:45"],
    ["10:55", "11:40"],
    ["14:00", "14:45"],
    ["14:55", "15:40"],
    ["16:00", "16:45"],
    ["16:55", "17:40"],
    ["19:00", "19:45"],
    ["19:55", "20:40"],
    ["20:50", "21:35"],
    ["21:45", "22:30"],
  ];
  // Seed by the current Monday so every page sees the same weekly arrangement.
  let seed = Number(weeks[3].startDate.replace(/-/g, ""));
  function shuffle<T>(items: T[]): T[] {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      seed = (seed * 16807) % 2147483647;
      const j = seed % (i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  // Mix one- to four-period blocks without overlapping or crossing meal breaks.
  const daySlots: Array<Array<[number, number]>> = [
    [
      [1, 2],
      [6, 8],
    ],
    [
      [3, 4],
      [9, 11],
    ],
    [
      [2, 4],
      [7, 7],
    ],
    [
      [1, 1],
      [5, 7],
      [11, 12],
    ],
    [
      [3, 4],
      [5, 8],
    ],
    [
      [2, 3],
      [10, 12],
    ],
    [
      [6, 7],
      [9, 9],
    ],
  ];
  const courseOrder = shuffle(DEMO_COURSES.map((_, i) => i));
  const slots = shuffle(daySlots).flatMap((dailySlots, day) =>
    dailySlots.map(([periodStart, periodEnd], i) => ({
      weekday: day + 1,
      courseIndex: courseOrder[(day * 2 + i) % courseOrder.length],
      periodStart,
      periodEnd,
    })),
  );
  const courses = DEMO_COURSES.map((courseName, i) => ({
    id: `demo-course-${i}`,
    courseCode: `DEMO00${i + 1}`,
    courseName,
    teachingClass: "示例教学班",
    teacherNames: [TEACHERS[i]],
    credits: i < 3 ? 3 : 2,
    category: "普通课程",
    nature: i < 3 ? "必修" : "通识选修",
    assessmentMethod: "考试",
    examMethod: "笔试",
    teachingClassComposition: ["计算机科学与技术1班"],
    retake: false,
    selectionStatus: "selected" as const,
    arrangements: slots
      .filter((slot) => slot.courseIndex === i)
      .map(({ weekday: day, periodStart, periodEnd }) => {
        return {
          id: `demo-arrangement-${i}-${day}`,
          weekday: day as 1 | 2 | 3 | 4 | 5 | 6 | 7,
          weekdayLabel: `周${["一", "二", "三", "四", "五", "六", "日"][day - 1]}`,
          periodStart,
          periodEnd,
          periods: Array.from(
            { length: periodEnd - periodStart + 1 },
            (_, index) => periodStart + index,
          ),
          startTime: periodTimes[periodStart - 1][0],
          endTime: periodTimes[periodEnd - 1][1],
          weekText: "1-20周",
          weeks: weeks.map((week) => week.weekNumber),
          activityType: "lecture" as const,
          activityTypeLabel: "理论课",
          teacherNames: [TEACHERS[i]],
          location: {
            campus: "北碚校区",
            building: "第八教学楼",
            room: `80${i + 1}`,
            display: `第八教学楼80${i + 1}`,
          },
          teachingMethod: "面授",
          selectionStatus: "selected" as const,
          adjusted: false,
        };
      }),
  }));
  return {
    semester,
    semesters: [semester],
    currentSemester: {
      ...semester,
      startDate: weeks[0].startDate,
      endDate: weeks[19].endDate,
    },
    semesterCalendar: {
      semesterId: semester.id,
      startDate: weeks[0].startDate,
      endDate: weeks[19].endDate,
      totalWeeks: 20,
      weeks,
    },
    dataSource: "teaching_system",
    sourceTimeZone: "Asia/Shanghai",
    periods: periodTimes.map(([startTime, endTime], i) => ({
      period: i + 1,
      startTime,
      endTime,
    })),
    courses,
    additionalCourses: [
      {
        id: "demo-practice",
        type: "practice",
        description: "程序设计课程实践",
      },
    ],
    summary: {
      courseCount: courses.length,
      arrangementCount: slots.length,
      maxWeek: 20,
    },
  };
}

export function demoSchedule(): LocalScheduleData {
  return {
    clientUpdatedAt: new Date().toISOString(),
    plans: ["图书馆自习", "英语听力练习", "课程小组讨论", "整理本周笔记"].map(
      (title, i) => ({
        id: `demo-plan-${i}`,
        title,
        date: demoDate(i),
        startTime: "20:50",
        endDate: demoDate(i),
        endTime: "21:30",
        done: false,
      }),
    ),
  };
}

export function demoGrades(): GradesData {
  const semester = demoSemester();
  const scores = [92, 88, 95, 90, 93];
  const items: GradeCourse[] = DEMO_COURSES.map((courseName, i) => ({
    id: `demo-course-${i}`,
    academicYear: semester.academicYearLabel,
    term: semester.term,
    courseCode: `DEMO00${i + 1}`,
    courseName,
    teachingClass: "示例教学班",
    teacherName: TEACHERS[i],
    department: "计算机与信息科学学院",
    courseNatureCode: i < 3 ? "01" : "03",
    courseNature: i < 3 ? "必修" : "通识选修",
    gradeNatureCode: "01",
    gradeNature: "初修",
    credits: i < 3 ? 3 : 2,
    finalScore: scores[i],
    calculationScore: scores[i],
    gradePoint: (scores[i] - 50) / 10,
    countsTowardGradePointAverage: true,
    gradeRemark: null,
    components: [
      { name: "平时", weightPercent: 40, score: scores[i] },
      { name: "期末", weightPercent: 60, score: scores[i] },
    ],
  }));
  const totalCredits = items.reduce(
    (sum, item) => sum + (item.credits || 0),
    0,
  );
  return {
    items,
    pagination: { page: 1, pageSize: 200, total: items.length, totalPages: 1 },
    semesters: [semester],
    summary: {
      courseCount: items.length,
      totalCredits,
      weightedAverage:
        items.reduce(
          (sum, item) => sum + Number(item.finalScore) * (item.credits || 0),
          0,
        ) / totalCredits,
      gradePointAverage:
        items.reduce(
          (sum, item) => sum + (item.gradePoint || 0) * (item.credits || 0),
          0,
        ) / totalCredits,
    },
  };
}

export function demoExams(): ExamsData {
  const semester = demoSemester();
  const items = DEMO_COURSES.slice(0, 3).map((name, i) => ({
    id: `demo-exam-${i}`,
    academicYear: semester.academicYearLabel,
    term: semester.term,
    arrangementType: "regular" as const,
    arrangementTypeLabel: "期末考试",
    examName: `${name}课程考试`,
    course: { code: `DEMO00${i + 1}`, name, credits: 3 },
    time: {
      date: demoDate(3 + i * 4),
      startTime: "09:00",
      endTime: "11:00",
      startAt: demoTimestamp(3 + i * 4, 9),
      endAt: demoTimestamp(3 + i * 4, 11),
      raw: "09:00-11:00",
    },
    location: { room: `第八教学楼80${i + 1}`, campus: "北碚校区" },
    method: "闭卷",
    teachingClass: "示例教学班",
    department: "计算机与信息科学学院",
    teacherNames: [TEACHERS[i]],
  }));
  return {
    items,
    pagination: { page: 1, pageSize: 200, total: 3, totalPages: 1 },
    semester,
    semesters: [semester],
    summary: {
      total: 3,
      regular: 3,
      makeup: 0,
      deferred: 0,
      makeupDeferred: 0,
    },
  };
}

export function demoMessages(): TeachingMessage[] {
  return [
    {
      id: "demo-message-0",
      createdAt: demoTimestamp(-1),
      type: "other",
      title: "课程学习提醒",
      parsed: false,
      content: "本周课程资料已更新，请及时完成课后练习。",
    },
    {
      id: "demo-message-1",
      createdAt: demoTimestamp(-2),
      type: "makeup_class",
      title: "程序设计基础补课提醒",
      parsed: true,
      courseName: "程序设计基础",
      teacherName: "王老师",
      schedule: {
        weekStart: 5,
        weekEnd: 5,
        weeks: [5],
        weekday: 3,
        periodStart: 7,
        periodEnd: 8,
        location: "第八教学楼803",
      },
    },
  ];
}

export function demoNotices(): NoticeDetail[] {
  return ["图书馆读书分享会", "校园文化活动报名", "本学期课程学习安排"].map(
    (title, i) => ({
      id: `demo-notice-${i}`,
      title,
      link: "",
      publishedAt: demoTimestamp(-i),
      semesterId: demoSemester().id,
      publisher: "校园服务中心",
      contentHtml: `<p>${title}</p><p>活动时间：${demoDate(i + 2)} 14:00</p><p>地点：图书馆报告厅。</p><p>欢迎同学们参加，共同交流学习心得。</p>`,
    }),
  );
}

export function demoElectricity(): ElectricityCachedData {
  return {
    binding: {
      buildingId: "demo-dorm-1",
      buildingName: "示例宿舍1栋",
      roomNumber: "0608",
      boundAt: demoTimestamp(-30),
      changedAt: demoTimestamp(-30),
    },
    accountFetchedAt: new Date().toISOString(),
    account: {
      billedElectricityKwh: 86.5,
      electricityFeeYuan: 48.44,
      remainingAmountYuan: 76.8,
      availableElectricitySubsidyKwh: 15,
      lastPaymentDate: demoTimestamp(-5),
      lastSettlementDate: demoTimestamp(-1),
      dailyElectricityFees: Array.from({ length: 14 }, (_, i) => ({
        date: demoDate(i - 13),
        amountYuan: Number((2.2 + (i % 5) * 0.35).toFixed(2)),
      })),
    },
  };
}

export function demoRoomOptions(): RoomOptionsData {
  const buildings = [
    { value: "demo-building-8", label: "第八教学楼" },
    { value: "demo-building-9", label: "第九教学楼" },
  ];
  return {
    minDate: demoDate(),
    maxDate: demoDate(30),
    campuses: [{ value: "demo-campus", label: "北碚校区" }],
    buildings,
    buildingsByCampus: { "demo-campus": buildings },
    periods: demoTimetable().periods,
    periodGroups: [
      { id: "morning", label: "上午", periods: [1, 2, 3, 4] },
      { id: "afternoon", label: "下午", periods: [5, 6, 7, 8] },
      { id: "evening", label: "晚上", periods: [9, 10, 11, 12] },
    ],
    source: { name: "示例数据", updatedAt: new Date().toISOString() },
  };
}

export function demoRooms(query: Record<string, string>): RoomsData {
  const buildingIds = (
    query.buildingIds || "demo-building-8,demo-building-9"
  ).split(",");
  const buildings = demoRoomOptions().buildings.filter((item) =>
    buildingIds.includes(item.value),
  );
  const items = buildings.flatMap((building) =>
    [201, 202, 301, 302].map((room) => ({
      id: `${building.value}-${room}`,
      code: String(room),
      name: String(room),
      campus: { id: "demo-campus", name: "北碚校区" },
      building: { id: building.value, name: building.label },
      floor: String(Math.floor(room / 100)),
      type: "多媒体教室",
      capacity: 60,
    })),
  );
  return {
    items,
    pagination: { page: 1, pageSize: 200, total: items.length, totalPages: 1 },
    query: {
      date: query.date || demoDate(),
      periods: (query.periods || "1,2").split(",").map(Number),
      campusId: query.campusId || "demo-campus",
      buildingIds,
    },
    dataUpdatedAt: new Date().toISOString(),
    summary: {
      totalRooms: items.length,
      buildings: buildings.map((item) => ({
        id: item.value,
        name: item.label,
        roomCount: 4,
      })),
    },
  };
}

export function demoPassRates(selected?: string): PassRatesData {
  const courses = demoGrades().items.map((course) => ({
    ...course,
    statisticsKey: course.id,
    hasOwnGrade: true,
  }));
  return {
    courses,
    selectedCourse:
      courses.find((course) => course.id === selected) || courses[0],
    percentageOnly: false,
    status: "ready",
    message: null,
    statistics: {
      cohorts: [demoSemester().academicYear],
      totalCount: 100,
      passedCount: 98,
      failedCount: 2,
      passRate: 98,
      averageScore: 85.8,
      distribution: [
        { band: "<60", count: 2 },
        { band: "60–69", count: 3 },
        { band: "70–79", count: 10 },
        { band: "80–89", count: 55 },
        { band: "90–100", count: 30 },
      ],
      scores: [
        { score: "55", count: 2 },
        { score: "65", count: 3 },
        { score: "75", count: 10 },
        { score: "85", count: 55 },
        { score: "95", count: 30 },
      ],
    },
  };
}

export function demoCalendar(year = demoSemester().academicYear): CalendarData {
  const academicYear = `${year}-${year + 1}`;
  return {
    academicYear,
    startYear: year,
    availableAcademicYears: [year],
    availableCalendars: [{ startYear: year, academicYear }],
    publishedAt: demoTimestamp(-7),
    sourcePageUrl: "",
    contentType: "image/png",
    size: 0,
    version: `demo-${demoDate()}-${year}`,
    imageUrl: "",
  };
}

export function demoDormStatus(): AutoDormCheckStatus {
  return {
    featureEnabled: false,
    entryEnabled: false,
    functionEnabled: false,
    available: false,
    agreementVersion: 1,
    agreementAccepted: false,
    agreementAcceptedAt: null,
    enabled: false,
    effectiveEnabled: false,
    checkInStatus: "disabled",
    checkInStartTime: "",
    checkInEndTime: "",
    schoolCheckInStartTime: "",
    schoolCheckInEndTime: "",
    plannedCheckInAt: null,
    plannedCheckInDate: null,
    updatedAt: new Date().toISOString(),
    lastCheckIn: null,
    checkInLocation: null,
    paymentEnabled: false,
    accessGranted: false,
    accessMode: "none",
    entitlement: {
      time: {
        remainingSeconds: 0,
        remainingDays: 0,
        paused: false,
        resumesAt: null,
      },
      uses: { remaining: 0, reserved: 0 },
    },
  };
}
