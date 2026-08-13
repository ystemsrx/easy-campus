export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface TeachingSuccess<T> extends ApiSuccess<T> {
  meta: {
    cached: boolean;
    fetchedAt?: string;
  };
}

export interface ApiErrorPayload {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  pagination: Pagination;
}

export interface Session {
  token: string;
  tokenType: "Bearer";
  expiresIn: 7776000;
  sliding: true;
  user: {
    id: string;
    account: string;
    name: string;
  };
  signedInAt: number;
}

export interface LoginData {
  token: string;
  tokenType: "Bearer";
  expiresIn: 7776000;
  sliding: true;
  user: Session["user"];
}

export interface CurrentUserData {
  id: string;
  account: string;
  name: string;
  profile: {
    name?: string;
    accountId?: string;
    gender?: string;
    grade?: string;
    organizationName?: string;
    majorName?: string;
    className?: string;
    programLength?: string;
    studentType?: string;
    studentStatus?: string;
    enrollmentDate?: string;
  };
}

export interface CalendarData {
  academicYear: string;
  startYear: number;
  publishedAt?: string | null;
  sourcePageUrl: string;
  contentType: string;
  size: number;
  imageUrl: string;
}

export type MessageType =
  "course_rescheduled" | "makeup_class" | "course_cancelled" | "other";

export interface MessageSchedule {
  weekStart: number;
  weekEnd: number;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  periodStart: number;
  periodEnd: number;
  location: string | null;
}

interface MessageBase {
  id: string;
  createdAt: string;
  type: MessageType;
  title: string;
  parsed: boolean;
}

export interface CourseRescheduledMessage extends MessageBase {
  type: "course_rescheduled";
  parsed: true;
  courseName: string;
  teacherName: string;
  originalSchedule: MessageSchedule;
  newTeacherName: string;
  newSchedule: MessageSchedule;
}

export interface MakeupClassMessage extends MessageBase {
  type: "makeup_class";
  parsed: true;
  courseName: string;
  teacherName: string;
  schedule: MessageSchedule;
}

export interface CourseCancelledMessage extends MessageBase {
  type: "course_cancelled";
  parsed: true;
  courseName: string;
  teacherName: string;
  schedule: MessageSchedule;
}

export interface OtherMessage extends MessageBase {
  type: "other";
  parsed: false;
  content: string;
}

export type TeachingMessage =
  | CourseRescheduledMessage
  | MakeupClassMessage
  | CourseCancelledMessage
  | OtherMessage;

export interface Notice {
  title: string;
  link: string;
  publishedAt: string;
}

export type PublicationKind = "announcement" | "notification";
export type PublicationIconTone = "default" | "warning" | "success" | "info";
export type PublicationReminderMode = "once" | "always" | "inbox";

export interface PublicationMedia {
  id: string;
  publicationId: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  url: string;
}

export interface Publication {
  id: string;
  kind: PublicationKind;
  title: string;
  contentMarkdown: string;
  iconTone: PublicationIconTone;
  accentColor: string;
  visibilityMode: "permanent" | "timed";
  reminderMode: PublicationReminderMode;
  startsAt: string;
  expiresAt: string | null;
  createdAt: string;
  isRead: boolean;
  readAt: string | null;
  shouldPopup: boolean;
  media: PublicationMedia[];
}

export interface PublicationFeed {
  items: Publication[];
  announcements: Publication[];
  notifications: Publication[];
  unreadCount: number;
}

export type GradeValue = number | string | null;

export interface GradeComponent {
  name: string;
  weightPercent: number | null;
  score: GradeValue;
}

export interface GradeCourse {
  id: string;
  academicYear: string;
  term: number | null;
  courseCode: string;
  courseName: string;
  teachingClass: string;
  department: string;
  credits: number | null;
  finalScore: GradeValue;
  gradeRemark: string | null;
  components: GradeComponent[];
}

export interface GradeSummary {
  courseCount: number;
  totalCredits: number;
  numericGradedCredits: number;
  numericWeightedAverage: number | null;
}

export interface GradesData extends Paginated<GradeCourse> {
  summary: GradeSummary;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface PeriodOption {
  period: number;
  startTime: string;
  endTime: string;
}

export interface PeriodGroup {
  id: "morning" | "noon" | "afternoon" | "evening";
  label: string;
  periods: number[];
}

export interface RoomOptionsData {
  minDate: string;
  maxDate: string;
  campuses: SelectOption[];
  buildings: SelectOption[];
  periods: PeriodOption[];
  periodGroups: PeriodGroup[];
  source: {
    name?: string;
    updatedAt?: string;
  };
}

export interface EmptyRoom {
  id: string;
  code: string;
  name: string;
  campus: {
    id?: string;
    name?: string;
  };
  building: {
    id?: string;
    name?: string;
  };
  floor?: string;
  type?: string;
  capacity?: number;
}

export interface RoomsData extends Paginated<EmptyRoom> {
  query: {
    date: string;
    periods: number[];
    campusId: string;
    buildingIds: string[];
  };
  dataUpdatedAt: string | null;
  summary: {
    totalRooms: number;
    buildings: Array<{
      id: string;
      name: string;
      roomCount: number;
    }>;
  };
}

export interface ExamOption {
  value: string;
  label: string;
}

export interface TermOption extends ExamOption {
  term: 1 | 2 | 3 | null;
}

export interface ExamOptionsData {
  academicYears: ExamOption[];
  terms: TermOption[];
  examNames: ExamOption[];
  departments: ExamOption[];
}

export interface ExamTime {
  date: string;
  startTime: string | null;
  endTime: string | null;
  startAt: string | null;
  endAt: string | null;
  raw: string;
}

export interface Exam {
  id: string;
  academicYear: string;
  term?: number;
  examName: string;
  course: {
    code: string;
    name: string;
    credits?: number;
  };
  time: ExamTime;
  location: {
    room: string;
    campus: string;
  };
  seatNumber?: string;
  method?: string;
  retake?: boolean;
  teachingClass: string;
  classComposition: string[];
  department: string;
  teacherNames: string[];
  note?: string;
}

export interface QueryMeta {
  cached: boolean;
  fetchedAt?: string;
}

export interface MessagesQuery {
  page?: number;
  pageSize?: number;
  type?: MessageType;
  from?: string;
  to?: string;
  refresh?: boolean;
}

export interface NoticesQuery {
  page?: number;
  pageSize?: number;
  q?: string;
  refresh?: boolean;
}

export interface GradesQuery {
  page?: number;
  pageSize?: number;
  academicYear?: number;
  term?: 1 | 2 | 3;
  q?: string;
  sort?: "academicYear" | "courseName" | "finalScore";
  order?: "asc" | "desc";
  refresh?: boolean;
}

export interface RoomsQuery {
  date: string;
  periods: number[];
  campusId: string;
  buildingIds: string[];
  page?: number;
  pageSize?: number;
  refresh?: boolean;
}

export interface ExamsQuery {
  academicYear: number;
  term: 1 | 2 | 3;
  startDate?: string;
  endDate?: string;
  q?: string;
  examNameId?: string;
  departmentId?: string;
  order?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  refresh?: boolean;
}
