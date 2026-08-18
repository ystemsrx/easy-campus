import type {
  AcademicSemesterOption,
  GradeComponent,
  GradeCourse,
  GradeSummary,
  GradesData,
} from "../types/api";

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
    (course) =>
      course.countsTowardGradePointAverage &&
      typeof course.gradePoint === "number",
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
