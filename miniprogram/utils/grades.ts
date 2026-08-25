import type {
  AcademicSemesterOption,
  GradeComponent,
  GradeCourse,
  GradeSummary,
  GradesData,
  TimetableData,
} from "../types/api";

const FAILING_LEVEL_GRADES = new Set(["E", "不及格"]);
const UNSUCCESSFUL_GRADE_PATTERN =
  /作弊|违纪|缺考|旷考|取消(?:考试)?资格|成绩无效|作废|不合格|未通过|不通过/;

interface TeachingClassPart {
  value: string;
  prefix: string;
  number: string;
  suffix: string;
  groupKey: string;
}

export function formatTeachingClassName(
  composition: readonly unknown[] | undefined,
): string {
  const source = Array.isArray(composition) ? composition : [];
  const values = [
    ...new Map(
      source
        .flatMap((value) =>
          String(value || "")
            .normalize("NFKC")
            .split(/[;；,，、|\n\r]+/),
        )
        .map((value) => value.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .map((value) => [value.replace(/\s+/g, ""), value]),
    ).values(),
  ];
  const parts: TeachingClassPart[] = values.map((value) => {
    const match = value.match(/^(.*?)(\d+)([^\d]*)$/);
    const prefix = match?.[1]?.trim() || "";
    const number = match?.[2] || "";
    const suffix = match?.[3]?.trim() || "";
    return {
      value,
      prefix,
      number,
      suffix,
      groupKey:
        prefix && number
          ? `${prefix.replace(/\s+/g, "")}\u0000${suffix.replace(/\s+/g, "")}`
          : "",
    };
  });
  const groups = new Map<string, TeachingClassPart[]>();
  for (const part of parts) {
    if (!part.groupKey) continue;
    const group = groups.get(part.groupKey) || [];
    group.push(part);
    groups.set(part.groupKey, group);
  }

  const renderedGroups = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    const group = groups.get(part.groupKey) || [];
    const numbers = [...new Set(group.map((item) => item.number))];
    if (part.groupKey && numbers.length > 1) {
      if (renderedGroups.has(part.groupKey)) continue;
      renderedGroups.add(part.groupKey);
      result.push(`${part.prefix}${numbers.join("、")}${part.suffix}`);
      continue;
    }
    result.push(part.value);
  }
  return result.join("；");
}

function hasMakeupOrDeferredMarker(value: unknown): boolean {
  return /补考|缓考|补[/、]?缓考/.test(String(value ?? ""));
}

export function isMakeupOrDeferredGrade(
  course: Pick<
    GradeCourse,
    "gradeNatureCode" | "gradeNature" | "finalScore" | "gradeRemark"
  >,
): boolean {
  return (
    course.gradeNatureCode === "11" ||
    course.gradeNatureCode === "12" ||
    hasMakeupOrDeferredMarker(course.gradeNature) ||
    hasMakeupOrDeferredMarker(course.finalScore) ||
    hasMakeupOrDeferredMarker(course.gradeRemark)
  );
}

export function gradeComponentWidths(components: GradeComponent[]): number[] {
  const declared = components.map((component) =>
    typeof component.weightPercent === "number" && component.weightPercent >= 0
      ? component.weightPercent
      : null,
  );
  const declaredTotal = declared.reduce<number>(
    (total, weight) => total + (weight || 0),
    0,
  );
  const missingCount = declared.filter((weight) => weight === null).length;
  const missingWeight = missingCount
    ? Math.max(0, 100 - declaredTotal) / missingCount
    : 0;
  const rawWeights = declared.map((weight) => weight ?? missingWeight);
  const totalWeight =
    rawWeights.reduce((total, weight) => total + weight, 0) ||
    components.length ||
    1;
  return rawWeights.map((weight) =>
    Number(((weight / totalWeight) * 100).toFixed(2)),
  );
}

function hasPublishedGrade(course: GradeCourse): boolean {
  if (course.finalScore === null) return false;
  return (
    typeof course.finalScore !== "string" || Boolean(course.finalScore.trim())
  );
}

function normalizedGradeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();
}

function normalizedCourseName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("zh-CN");
}

export interface GradeTimetableSemester {
  academicYear: number;
  term: 1 | 2 | 3;
  id: string;
}

export function gradeTimetableSemester(
  grade: Pick<
    GradeCourse,
    | "academicYear"
    | "term"
    | "gradeNatureCode"
    | "gradeNature"
    | "finalScore"
    | "gradeRemark"
  >,
): GradeTimetableSemester | null {
  let academicYear = Number(
    String(grade.academicYear || "").match(/(?:19|20)\d{2}/)?.[0],
  );
  let term = Number(grade.term);
  if (
    !Number.isInteger(academicYear) ||
    academicYear < 1900 ||
    academicYear > 2099 ||
    ![1, 2, 3].includes(term)
  ) {
    return null;
  }
  if (isMakeupOrDeferredGrade(grade)) {
    if (term === 1) {
      academicYear -= 1;
      term = 2;
    } else {
      term -= 1;
    }
  }
  const timetableTerm = term as 1 | 2 | 3;
  return {
    academicYear,
    term: timetableTerm,
    id: `${academicYear}-${timetableTerm}`,
  };
}

export function timetableTeachingClassName(
  grade: Pick<
    GradeCourse,
    | "academicYear"
    | "term"
    | "courseName"
    | "gradeNatureCode"
    | "gradeNature"
    | "finalScore"
    | "gradeRemark"
  >,
  timetable: Pick<TimetableData, "semester" | "courses"> | null,
): string {
  const targetSemester = gradeTimetableSemester(grade);
  if (!timetable || !targetSemester) return "";
  if (
    timetable.semester.academicYear !== targetSemester.academicYear ||
    timetable.semester.term !== targetSemester.term
  ) {
    return "";
  }
  const courseName = normalizedCourseName(grade.courseName);
  if (!courseName) return "";
  return formatTeachingClassName(
    timetable.courses
      .filter(
        (course) => normalizedCourseName(course.courseName) === courseName,
      )
      .flatMap((course) => course.teachingClassComposition || []),
  );
}

function directNumericScore(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  }
  const normalized = normalizedGradeText(value);
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? parsed
    : null;
}

export function isUnsuccessfulGrade(
  course: Pick<GradeCourse, "finalScore" | "gradeRemark" | "gradeNature">,
): boolean {
  const finalScore = directNumericScore(course.finalScore);
  const labels = [
    course.finalScore,
    course.gradeRemark,
    course.gradeNature,
  ].map(normalizedGradeText);
  return (
    (finalScore !== null && finalScore < 60) ||
    labels.some((label) => FAILING_LEVEL_GRADES.has(label)) ||
    labels.some((label) => UNSUCCESSFUL_GRADE_PATTERN.test(label))
  );
}

function isCourseInSemester(
  course: GradeCourse,
  semester: AcademicSemesterOption,
): boolean {
  return (
    course.academicYear.startsWith(`${semester.academicYear}-`) &&
    course.term === semester.term
  );
}

export function latestGradedSemester(
  data: GradesData,
): AcademicSemesterOption | null {
  const semesters = [...data.semesters].sort(
    (left, right) =>
      right.academicYear - left.academicYear || right.term - left.term,
  );
  return (
    semesters.find((semester) =>
      data.items.some(
        (course) =>
          isCourseInSemester(course, semester) && hasPublishedGrade(course),
      ),
    ) ||
    semesters[0] ||
    null
  );
}

export function summarizeGrades(courses: GradeCourse[]): GradeSummary {
  const scoredCourses = courses.filter(
    (course) =>
      typeof course.credits === "number" &&
      course.credits > 0 &&
      typeof course.calculationScore === "number",
  );
  const weightedCredits = scoredCourses.reduce(
    (total, course) => total + (course.credits || 0),
    0,
  );
  const weightedTotal = scoredCourses.reduce(
    (total, course) =>
      total + (course.credits || 0) * (course.calculationScore || 0),
    0,
  );
  const gradePointCourses = scoredCourses.filter(
    (course) => typeof course.gradePoint === "number",
  );
  const gradePointCredits = gradePointCourses.reduce(
    (total, course) => total + (course.credits || 0),
    0,
  );
  const gradePointTotal = gradePointCourses.reduce(
    (total, course) => total + (course.credits || 0) * (course.gradePoint || 0),
    0,
  );
  return {
    courseCount: courses.length,
    totalCredits: Number(
      courses
        .reduce((total, course) => total + (course.credits || 0), 0)
        .toFixed(2),
    ),
    weightedAverage: weightedCredits
      ? Number((weightedTotal / weightedCredits).toFixed(2))
      : null,
    gradePointAverage: gradePointCredits
      ? Number((gradePointTotal / gradePointCredits).toFixed(2))
      : null,
  };
}

function comparableCourseScore(course: GradeCourse): number | null {
  return typeof course.calculationScore === "number" &&
    Number.isFinite(course.calculationScore)
    ? course.calculationScore
    : directNumericScore(course.finalScore);
}

export function highestGradesByCourseName(
  courses: GradeCourse[],
): GradeCourse[] {
  const selected = new Map<string, GradeCourse>();

  courses.forEach((course, index) => {
    if (!hasPublishedGrade(course)) return;
    const courseName = normalizedCourseName(course.courseName);
    const key = courseName || `unnamed:${index}`;
    const existing = selected.get(key);
    if (!existing) {
      selected.set(key, course);
      return;
    }

    const score = comparableCourseScore(course);
    const existingScore = comparableCourseScore(existing);
    if (
      (score !== null && existingScore === null) ||
      (score !== null && existingScore !== null && score > existingScore)
    ) {
      selected.set(key, course);
    }
  });

  return [...selected.values()];
}

export function withoutUnsuccessfulGrades(data: GradesData): GradesData {
  const items = data.items.filter((course) => !isUnsuccessfulGrade(course));
  return {
    ...data,
    items,
    pagination: {
      page: 1,
      pageSize: Math.max(1, data.pagination.pageSize),
      total: items.length,
      totalPages: items.length ? 1 : 0,
    },
    summary: summarizeGrades(items),
  };
}

export function gradesForSemester(
  data: GradesData,
  semester: AcademicSemesterOption,
): GradesData {
  const items = data.items.filter((course) =>
    isCourseInSemester(course, semester),
  );
  return {
    ...data,
    items,
    pagination: {
      page: 1,
      pageSize: Math.max(1, data.pagination.pageSize),
      total: items.length,
      totalPages: items.length ? 1 : 0,
    },
    summary: summarizeGrades(items),
  };
}

export function latestSemesterGrades(data: GradesData): GradesData {
  const semester = latestGradedSemester(data);
  return semester ? gradesForSemester(data, semester) : data;
}

export function gradePointRingValue(value: number | null): number | null {
  return value === null ? null : (value / 5) * 100;
}
