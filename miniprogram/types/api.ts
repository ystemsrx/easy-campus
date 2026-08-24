import type { PetShapeId } from "../components/geometric-pet/engine-data";

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface TeachingSuccess<T> extends ApiSuccess<T> {
  meta: {
    cached: boolean;
    fetchedAt?: string;
    refreshing?: boolean;
    stale?: boolean;
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
  loginMode: "local" | "campus";
  credential: CredentialState;
  user: {
    id: string;
    account: string;
    name: string;
    companion: CompanionPreferencesData | null;
  };
  signedInAt: number;
}

export interface LoginData {
  token: string;
  tokenType: "Bearer";
  expiresIn: 7776000;
  sliding: true;
  loginMode: "local" | "campus";
  credential: CredentialState;
  user: Session["user"];
}

export type CredentialStatus =
  "verified" | "pending" | "invalid" | "unavailable";

export interface CredentialState {
  status: CredentialStatus;
  checkedAt: string | null;
  errorCode: string | null;
}

export interface CurrentUserData {
  id: string;
  account: string;
  name: string;
  credential: CredentialState;
  companion: CompanionPreferencesData | null;
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

export interface CompanionPreferencesData {
  selected: boolean;
  skipped: boolean;
  enabled: boolean;
  enhanced: boolean;
  shape: PetShapeId;
  color: string;
  updatedAt: string | null;
}

export interface CalendarAcademicYearOption {
  startYear: number;
  academicYear: string;
}

export interface CalendarData {
  academicYear: string;
  startYear: number;
  availableAcademicYears: number[];
  availableCalendars: CalendarAcademicYearOption[];
  publishedAt?: string | null;
  sourcePageUrl: string;
  contentType: string;
  size: number;
  version: string;
  imageUrl: string;
}

export type MessageType =
  "course_rescheduled" | "makeup_class" | "course_cancelled" | "other";

export interface MessageSchedule {
  weekStart: number;
  weekEnd: number;
  weeks?: number[];
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
  id: string;
  title: string;
  link: string;
  publishedAt: string;
}

export interface NoticeDetail extends Notice {
  publisher: string | null;
  contentHtml: string;
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
  term: 1 | 2 | 3 | null;
  courseCode: string;
  courseName: string;
  teachingClass: string;
  teacherName: string;
  department: string;
  courseNatureCode: string | null;
  courseNature: string | null;
  gradeNatureCode: string | null;
  gradeNature: string | null;
  credits: number | null;
  finalScore: GradeValue;
  calculationScore: number | null;
  gradePoint: number | null;
  countsTowardGradePointAverage: boolean;
  gradeRemark: string | null;
  components: GradeComponent[];
}

export interface GradeSummary {
  courseCount: number;
  totalCredits: number;
  weightedAverage: number | null;
  gradePointAverage: number | null;
}

export interface AcademicSemesterOption {
  id: string;
  academicYear: number;
  academicYearLabel: string;
  term: 1 | 2 | 3;
  label: string;
}

export interface GradesData extends Paginated<GradeCourse> {
  summary: GradeSummary;
  semesters: AcademicSemesterOption[];
}

export interface GradeClassDistributionItem {
  score: number;
  count: number;
}

export interface GradeClassDistributionData {
  status: "ready" | "insufficient";
  distribution: GradeClassDistributionItem[];
}

export interface PassRateCourse extends GradeCourse {
  statisticsKey: string;
  hasOwnGrade: boolean;
}

export interface PassRateDistributionItem {
  band: "<60" | "60–69" | "70–79" | "80–89" | "90–100";
  count: number;
}

export interface PassRateScoreItem {
  score: string;
  count: number;
}

export interface PassRateStatistics {
  cohorts: number[];
  totalCount: number;
  passedCount: number;
  failedCount: number;
  passRate: number;
  averageScore: number;
  distribution: PassRateDistributionItem[];
  scores: PassRateScoreItem[];
}

export interface PassRatesData {
  courses: PassRateCourse[];
  selectedCourse: PassRateCourse | null;
  percentageOnly: boolean;
  status: "ready" | "collecting";
  message: string | null;
  statistics: PassRateStatistics | null;
}

export type CourseAssistantCourseType =
  "general_elective" | "physical_education";
export type CourseAssistantCatalogSort = "average_score" | "rating";

export type CourseAssistantKeywordSentiment =
  "positive" | "neutral" | "negative";

export interface CourseAssistantKeyword {
  text: string;
  sentiment: CourseAssistantKeywordSentiment;
  count?: number;
}

export interface CourseAssistantKeywordGroups {
  positive: string[];
  neutral: string[];
  negative: string[];
}

export interface CourseAssistantReviewAccess {
  allowed: boolean;
  requiresContribution: boolean;
  exempt: boolean;
  eligibleCourseCount: number;
  ownReviewCount: number;
}

export interface CourseAssistantDistributionItem {
  label: "90+" | "85–89" | "80–84" | "<80";
  count: number;
  percentage: number;
}

export interface CourseAssistantHistoryItem {
  academicYearStart: number | null;
  term: number | null;
  label: string;
  averageScore: number | null;
  count: number;
}

export interface CourseAssistantCourse {
  courseKey: string;
  type: CourseAssistantCourseType;
  courseName: string;
  displayName: string;
  sportName: string | null;
  teacherNames: string[];
  credits: number | null;
  averageScore: number | null;
  rating: number | null;
  recommendationRate: number | null;
  gradeCount: number;
  contributorCount: number;
  reviewCount: number;
  termsLabel: string | null;
  history: CourseAssistantHistoryItem[];
  distribution: CourseAssistantDistributionItem[];
  keywords: CourseAssistantKeyword[];
}

export interface CourseAssistantReview {
  id: string;
  courseKey?: string;
  courseName?: string;
  displayName?: string;
  authorLabel: "我（匿名）" | "匿名同学";
  own: boolean;
  termLabel: string;
  teacherNames: string[];
  calculationScore: number | null;
  rating: number;
  keywords: CourseAssistantKeyword[];
  content: string;
  likeCount: number;
  liked: boolean;
  createdAt: string | null;
}

export interface CourseAssistantGrade {
  attemptKey: string;
  courseKey: string;
  type: CourseAssistantCourseType;
  courseName: string;
  displayName: string;
  sportName: string | null;
  courseNature: string | null;
  academicYear: string | null;
  academicYearStart: number | null;
  term: number | null;
  termLabel: string;
  finalScore: GradeValue;
  calculationScore: number | null;
  teacherName: string | null;
  credits: number | null;
  sourceFetchedAt: string | null;
  reviewed?: boolean;
  reviewId?: string | null;
}

export interface CourseAssistantCourseDetail extends CourseAssistantCourse {
  reviews: CourseAssistantReview[];
  ownGrade: CourseAssistantGrade | null;
  canReview: boolean;
  ownReviewId: string | null;
  reviewAccess: CourseAssistantReviewAccess;
}

export interface CourseAssistantCatalog extends Paginated<CourseAssistantCourse> {
  summary: {
    courseCount: number;
    reviewCount: number;
    contributorCount: number;
  };
  keywords: CourseAssistantKeywordGroups;
  reviewAccess: CourseAssistantReviewAccess;
}

export interface CourseAssistantMine {
  grades: CourseAssistantGrade[];
  reviews: CourseAssistantReview[];
  keywords: CourseAssistantKeywordGroups;
  reviewAccess: CourseAssistantReviewAccess;
}

export interface CourseAssistantCatalogQuery {
  page?: number;
  pageSize?: number;
  type?: CourseAssistantCourseType;
  q?: string;
  keyword?: string;
  sort?: CourseAssistantCatalogSort;
}

export interface CourseAssistantReviewInput {
  courseKey: string;
  rating: number;
  keywords: string[];
  content: string;
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
  buildingsByCampus: Record<string, SelectOption[]>;
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

export interface ElectricityBuilding {
  id: string;
  name: string;
}

export interface ElectricityBuildingsData {
  buildings: ElectricityBuilding[];
}

export interface ElectricityAccount {
  billedElectricityKwh: number;
  electricityFeeYuan: number;
  remainingAmountYuan: number;
  lastPaymentDate: string | null;
  lastSettlementDate: string | null;
}

export interface ElectricityBinding {
  buildingId: string;
  buildingName: string;
  roomNumber: string;
  boundAt?: string | null;
  changedAt?: string | null;
}

export interface ElectricityCachedData {
  binding: ElectricityBinding | null;
  account: ElectricityAccount | null;
}

export interface ElectricityQuery {
  buildingId: string;
  buildingName?: string;
  roomNumber: string;
}

export interface LocalSchedulePlan {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
  done: boolean;
}

export interface LocalScheduleData {
  plans: LocalSchedulePlan[];
  clientUpdatedAt: string | null;
}

export interface ExamOptionsData {
  semesters: AcademicSemesterOption[];
  defaultSemester: AcademicSemesterOption | null;
}

export type ExamArrangementType =
  "regular" | "makeup" | "deferred" | "makeup_deferred";

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
  term?: 1 | 2 | 3;
  arrangementType: ExamArrangementType;
  arrangementTypeLabel: string;
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
  method?: string;
  retake?: boolean;
  teachingClass: string;
  department: string;
  teacherNames: string[];
  note?: string;
}

export interface ExamSummary {
  total: number;
  regular: number;
  makeup: number;
  deferred: number;
  makeupDeferred: number;
}

export interface ExamsData extends Paginated<Exam> {
  semester: AcademicSemesterOption | null;
  semesters: AcademicSemesterOption[];
  summary: ExamSummary;
}

export interface TimetableCurrentSemester extends AcademicSemesterOption {
  startDate: string;
  endDate: string;
}

export interface TimetableCalendarWeek {
  weekNumber: number;
  startDate: string;
  endDate: string;
}

export interface TimetableSemesterCalendar {
  semesterId: string;
  startDate: string;
  endDate: string;
  totalWeeks: number;
  weeks: TimetableCalendarWeek[];
}

export interface TimetablePeriod {
  period: number;
  startTime: string;
  endTime: string;
}

export type TimetableActivityType =
  "lecture" | "practice" | "experiment" | "other";

export interface TimetableArrangement {
  id: string;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  weekdayLabel: string;
  periodStart: number;
  periodEnd: number;
  periods: number[];
  startTime: string | null;
  endTime: string | null;
  weekText: string;
  weeks: number[];
  activityType: TimetableActivityType;
  activityTypeLabel: string;
  teacherNames: string[];
  location: {
    campus: string | null;
    building: string | null;
    room: string | null;
    display: string;
  };
  teachingMethod: string | null;
  selectionStatus: "selected" | "pending";
  adjusted: boolean;
}

export interface TimetableCourseData {
  id: string;
  courseCode: string;
  courseName: string;
  teachingClass: string | null;
  teacherNames: string[];
  credits: number | null;
  category: string | null;
  nature: string | null;
  assessmentMethod: string | null;
  examMethod: string | null;
  teachingClassComposition: string[];
  hours?: {
    composition?: string;
    weekly?: number;
    total?: number;
  };
  retake: boolean | null;
  selectionStatus: "selected" | "pending";
  arrangements: TimetableArrangement[];
}

export interface TimetableAdditionalCourse {
  id: string;
  type: "practice" | "other";
  description: string;
  note?: string | null;
}

export interface TimetableData {
  semester: AcademicSemesterOption;
  semesters: AcademicSemesterOption[];
  currentSemester: TimetableCurrentSemester | null;
  semesterCalendar: TimetableSemesterCalendar | null;
  dataSource: "teaching_system" | "one_stop";
  sourceTimeZone: "Asia/Shanghai" | string;
  periods: TimetablePeriod[];
  courses: TimetableCourseData[];
  additionalCourses: TimetableAdditionalCourse[];
  summary: {
    courseCount: number;
    arrangementCount: number;
    maxWeek: number;
  };
}

export interface QueryMeta {
  cached: boolean;
  fetchedAt?: string;
  refreshing?: boolean;
  stale?: boolean;
}

export interface MessagesQuery {
  page?: number;
  pageSize?: number;
  type?: MessageType;
  types?: MessageType[];
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
  sort?: "default" | "academicYear" | "courseName" | "finalScore";
  order?: "asc" | "desc";
  includeUnsuccessful?: boolean;
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
  semester?: string;
  page?: number;
  pageSize?: number;
  refresh?: boolean;
}

export interface TimetableQuery {
  semester?: string;
  refresh?: boolean;
}
