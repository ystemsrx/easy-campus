import type {
  CourseAssistantCourseDetail,
  CourseAssistantGrade,
  CourseAssistantKeywordGroups,
  CourseAssistantReview,
  CourseAssistantReviewAccess,
  Publication,
} from "../types/api";
import { demoDate, demoSemester, demoTimestamp } from "./data";

// Match the course-key contract used by detail links and saved favorites.
const DEMO_COURSE_KEYS = ["1".padStart(64, "0"), "2".padStart(64, "0")];

export function normalizeDemoCourseKey(courseKey: string): string {
  const legacy = /^demo-assistant-([01])$/.exec(courseKey);
  return legacy ? DEMO_COURSE_KEYS[Number(legacy[1])] : courseKey;
}

export const DEMO_KEYWORDS: CourseAssistantKeywordGroups = {
  positive: ["讲解清晰", "收获很多", "氛围轻松"],
  neutral: ["需要预习"],
  negative: ["作业较多"],
};
export const DEMO_REVIEW_ACCESS: CourseAssistantReviewAccess = {
  allowed: true,
  requiresContribution: false,
  exempt: true,
  eligibleCourseCount: 2,
  ownReviewCount: 1,
};

export function demoPublications(): Publication[] {
  return ["欢迎体验校园助手", "本周校园活动"].map((title, i) => ({
    id: `demo-publication-${i}`,
    kind: i === 0 ? "announcement" : "notification",
    title,
    contentMarkdown:
      i === 0
        ? "课表、日程和校园消息都在这里。祝你拥有充实愉快的校园生活。"
        : `读书分享会将于 ${demoDate(2)} 举行，欢迎参加。`,
    iconTone: "info",
    accentColor: "#6d8c73",
    visibilityMode: "permanent",
    reminderMode: "inbox",
    startsAt: demoTimestamp(-2),
    expiresAt: null,
    createdAt: demoTimestamp(-i - 1),
    isRead: false,
    readAt: null,
    shouldPopup: false,
    media: [],
  }));
}

export function demoOwnGrades(): CourseAssistantGrade[] {
  const semester = demoSemester();
  return ["中国文化概论", "大学体育"].map((courseName, i) => ({
    attemptKey: `demo-attempt-${i}`,
    courseKey: DEMO_COURSE_KEYS[i],
    type: i === 0 ? "general_elective" : "physical_education",
    courseName,
    displayName: courseName,
    sportName: i === 1 ? "羽毛球" : null,
    courseNature: i === 0 ? "通识选修" : "体育",
    academicYear: semester.academicYearLabel,
    academicYearStart: semester.academicYear,
    term: semester.term,
    termLabel: semester.label,
    finalScore: 90 + i * 3,
    calculationScore: 90 + i * 3,
    teacherName: "陈老师",
    credits: 2,
    sourceFetchedAt: demoTimestamp(-3),
    reviewed: false,
    reviewId: null,
  }));
}

export function demoReviews(): CourseAssistantReview[] {
  const reviews: CourseAssistantReview[] = demoOwnGrades().map((grade, i) => ({
    id: `demo-review-${i}`,
    courseKey: grade.courseKey,
    courseName: grade.courseName,
    displayName: grade.displayName,
    authorLabel: "匿名同学",
    own: false,
    underReview: false,
    termLabel: grade.termLabel,
    teacherNames: ["陈老师"],
    calculationScore: 90,
    rating: 5,
    keywords: [{ text: "讲解清晰", sentiment: "positive" }],
    content:
      i === 0
        ? "课堂内容丰富，老师讲解清晰，能够了解不少有趣的文化知识。"
        : "课堂氛围轻松，练习安排充实，运动后很有成就感。",
    likeCount: 12,
    liked: false,
    createdAt: demoTimestamp(-2),
  }));
  return [
    ...reviews,
    {
      ...reviews[0],
      id: `demo-own-${DEMO_COURSE_KEYS[0]}`,
      authorLabel: "我（匿名）",
      own: true,
      content: "通过这门课认识了不同地域的文化，课堂讨论也很有收获。",
      likeCount: 3,
    },
  ];
}

export function demoAssistantCourses(
  reviews: CourseAssistantReview[],
): CourseAssistantCourseDetail[] {
  return demoOwnGrades().map((grade) => {
    const courseReviews = reviews.filter(
      (review) => review.courseKey === grade.courseKey,
    );
    const own = courseReviews.find((review) => review.own);
    return {
      courseKey: grade.courseKey,
      type: grade.type,
      courseName: grade.courseName,
      displayName: grade.displayName,
      sportName: grade.sportName,
      teacherNames: ["陈老师"],
      credits: 2,
      averageScore: 90,
      rating: 4.8,
      recommendationRate: 96,
      gradeCount: 80,
      contributorCount: 60,
      reviewCount: courseReviews.length,
      termsLabel: grade.termLabel,
      history: [
        {
          academicYearStart: grade.academicYearStart,
          term: grade.term,
          label: grade.termLabel,
          averageScore: 90,
          count: 80,
        },
      ],
      distribution: [
        { label: "90+", count: 48, percentage: 60 },
        { label: "85–89", count: 24, percentage: 30 },
        { label: "80–84", count: 8, percentage: 10 },
        { label: "<80", count: 0, percentage: 0 },
      ],
      keywords: [{ text: "讲解清晰", sentiment: "positive", count: 20 }],
      reviews: courseReviews,
      ownGrade: grade,
      canReview: !own,
      ownReviewId: own?.id || null,
      reviewAccess: DEMO_REVIEW_ACCESS,
    };
  });
}
