import { getApiBaseUrl } from "../config/index";
import { getSession } from "../store/session";
import type {
  CalendarData,
  ExamsData,
  ExamOptionsData,
  ExamsQuery,
  GradesData,
  GradesQuery,
  MessagesQuery,
  Notice,
  NoticeDetail,
  NoticesQuery,
  Paginated,
  QueryMeta,
  RoomOptionsData,
  RoomsData,
  RoomsQuery,
  TeachingMessage,
  TimetableData,
  TimetableQuery,
} from "../types/api";
import { buildQuery, type QueryValue } from "../utils/query";
import {
  ApiClientError,
  apiRequest,
  handleAuthenticationFailure,
  teachingRequest,
} from "./request";

export interface TeachingResult<T> {
  data: T;
  meta: QueryMeta;
}

function asQuery(input: object): Record<string, QueryValue> {
  return input as Record<string, QueryValue>;
}

export function getCalendar(
  academicYear?: number,
  refresh = false,
): Promise<CalendarData> {
  return apiRequest<CalendarData>(
    `/teaching/calendar${buildQuery({ academicYear, refresh: refresh || undefined })}`,
  );
}

export function getMessages(
  query: MessagesQuery = {},
): Promise<TeachingResult<Paginated<TeachingMessage>>> {
  return teachingRequest<Paginated<TeachingMessage>>(
    `/teaching/messages${buildQuery(asQuery(query))}`,
  );
}

export function getNotices(
  query: NoticesQuery = {},
): Promise<TeachingResult<Paginated<Notice>>> {
  return teachingRequest<Paginated<Notice>>(
    `/teaching/notices${buildQuery(asQuery(query))}`,
  );
}

export function getNoticeDetail(
  id: string,
  refresh = false,
): Promise<TeachingResult<NoticeDetail>> {
  return teachingRequest<NoticeDetail>(
    `/teaching/notices/detail${buildQuery({ id, refresh: refresh || undefined })}`,
  );
}

export function getGrades(
  query: GradesQuery = {},
): Promise<TeachingResult<GradesData>> {
  return teachingRequest<GradesData>(
    `/teaching/grades${buildQuery(asQuery(query))}`,
  );
}

export function getRoomOptions(
  campusId?: string,
): Promise<TeachingResult<RoomOptionsData>> {
  return teachingRequest<RoomOptionsData>(
    `/teaching/rooms/options${buildQuery({ campusId })}`,
  );
}

export function getRooms(
  query: RoomsQuery,
): Promise<TeachingResult<RoomsData>> {
  return teachingRequest<RoomsData>(
    `/teaching/rooms${buildQuery(asQuery(query))}`,
  );
}

export function getExamOptions(): Promise<TeachingResult<ExamOptionsData>> {
  return teachingRequest<ExamOptionsData>("/teaching/exams/options");
}

export function getExams(
  query: ExamsQuery,
): Promise<TeachingResult<ExamsData>> {
  return teachingRequest<ExamsData>(
    `/teaching/exams${buildQuery(asQuery(query))}`,
  );
}

export function getTimetable(
  query: TimetableQuery = {},
): Promise<TeachingResult<TimetableData>> {
  return teachingRequest<TimetableData>(
    `/teaching/timetable${buildQuery(asQuery(query))}`,
  );
}

export function downloadCalendarImage(
  academicYear: number,
  refresh = false,
): Promise<string> {
  const session = getSession();
  if (!session) {
    return Promise.reject(
      new ApiClientError({
        code: "INVALID_TOKEN",
        message: "请先登录。",
        statusCode: 401,
      }),
    );
  }

  const query = buildQuery({ academicYear, refresh: refresh || undefined });
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${getApiBaseUrl()}/teaching/calendar/image${query}`,
      header: { Authorization: `Bearer ${session.token}` },
      timeout: 60000,
      success: (response) => {
        if (response.statusCode === 200) {
          resolve(response.tempFilePath);
          return;
        }
        const error = new ApiClientError({
          code:
            response.statusCode === 401
              ? "INVALID_TOKEN"
              : "CALENDAR_DOWNLOAD_FAILED",
          message: "校历图片下载失败，请稍后重试。",
          statusCode: response.statusCode,
        });
        if (response.statusCode === 401) {
          handleAuthenticationFailure(error);
        }
        reject(error);
      },
      fail: () => {
        reject(
          new ApiClientError({
            code: "NETWORK_ERROR",
            message: "校历图片下载失败，请检查网络。",
            statusCode: 0,
          }),
        );
      },
    });
  });
}
