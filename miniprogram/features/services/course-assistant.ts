import type {
  CourseAssistantCatalog,
  CourseAssistantCatalogQuery,
  CourseAssistantCourseDetail,
  CourseAssistantMine,
  CourseAssistantReview,
  CourseAssistantReviewInput,
} from "../../types/api";
import { buildQuery, type QueryValue } from "../../utils/query";
import { apiRequest } from "../../services/request";

const ROOT = "/course-assistant";

export function getCourseAssistantCatalog(
  query: CourseAssistantCatalogQuery = {},
): Promise<CourseAssistantCatalog> {
  return apiRequest<CourseAssistantCatalog>(
    `${ROOT}/courses${buildQuery(query as Record<string, QueryValue>)}`,
  );
}

export function getCourseAssistantCourse(
  courseKey: string,
): Promise<CourseAssistantCourseDetail> {
  return apiRequest<CourseAssistantCourseDetail>(
    `${ROOT}/courses/${encodeURIComponent(courseKey)}`,
  );
}

export function getMyCourseAssistantData(): Promise<CourseAssistantMine> {
  return apiRequest<CourseAssistantMine>(`${ROOT}/mine`, { timeout: 70000 });
}

export function publishCourseAssistantReview(
  input: CourseAssistantReviewInput,
): Promise<CourseAssistantReview> {
  return apiRequest<CourseAssistantReview>(`${ROOT}/reviews`, {
    method: "POST",
    data: input,
    retry: false,
  });
}

export function toggleCourseAssistantReviewLike(
  reviewId: string,
): Promise<{ liked: boolean; likeCount: number }> {
  return apiRequest<{ liked: boolean; likeCount: number }>(
    `${ROOT}/reviews/${encodeURIComponent(reviewId)}/like`,
    { method: "POST", data: {}, retry: false },
  );
}
