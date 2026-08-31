import {
  getCourseAssistantCatalog,
  getMyCourseAssistantData,
  publishCourseAssistantReview,
} from "../../services/course-assistant";
import { getErrorMessage } from "../../../services/request";
import {
  loadCourseAssistantFavorites,
  toggleCourseAssistantFavorite,
} from "../../store/course-assistant";
import {
  captureSessionLease,
  isSessionLeaseCurrent,
  sessionLeaseKey,
} from "../../../store/session";
import type {
  CourseAssistantCatalogSort,
  CourseAssistantCourse,
  CourseAssistantCourseType,
  CourseAssistantGrade,
  CourseAssistantKeywordGroups,
  CourseAssistantReview,
  CourseAssistantReviewAccess,
} from "../../../types/api";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../../utils/appearance";
import { formatCourseTeacherNames } from "../../utils/course-assistant";
import { formatCredits, formatScore } from "../../../utils/format";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated, navigateTo } from "../../../utils/navigation";
import {
  canActivateTap,
  movementExceedsTapThreshold,
  type TapPoint,
} from "../../utils/tap-guard";

type AssistantTab = "browse" | "publish";
type KeywordSentiment = "positive" | "neutral" | "negative";

interface StarView {
  value: number;
  active: boolean;
}

interface CourseCardView extends CourseAssistantCourse {
  indexLabel: string;
  typeLabel: string;
  teacherLabel: string;
  creditsLabel: string;
  scoreLabel: string;
  ratingLabel: string;
  favorite: boolean;
  stars: StarView[];
  thoughtsLocked: boolean;
}

interface GradeView extends CourseAssistantGrade {
  typeLabel: string;
  scoreLabel: string;
  metaLabel: string;
}

interface ReviewView extends CourseAssistantReview {
  courseKey?: string;
  displayName?: string;
  stars: StarView[];
  visibleKeywords: CourseAssistantReview["keywords"];
  remainingKeywordCount: number;
}

interface KeywordOption {
  text: string;
  sentiment: KeywordSentiment;
  active: boolean;
}

interface CatalogCacheEntry {
  courses: CourseAssistantCourse[];
  page: number;
  hasMore: boolean;
  summary: {
    courseCount: number;
    reviewCount: number;
    contributorCount: number;
  };
  positiveFilterKeywords: string[];
  reviewAccess: CourseAssistantReviewAccess;
}

const DEFAULT_KEYWORDS: CourseAssistantKeywordGroups = {
  positive: ["讲得好", "性格好", "不考勤", "作业少/无", "任务少", "管理松"],
  neutral: ["随机考勤", "有作业", "会点人", "偶尔忙"],
  negative: ["事多", "作业多", "任务多", "有汇报", "管理严", "性格差"],
};
const STAR_HINTS = [
  "",
  "不推荐，慎重考虑",
  "勉强及格，有坑需注意",
  "中规中矩，看需求选",
  "不错，值得选",
  "力荐，闭眼选",
];
const DEFAULT_REVIEW_ACCESS: CourseAssistantReviewAccess = {
  allowed: true,
  requiresContribution: false,
  exempt: true,
  eligibleCourseCount: 0,
  ownReviewCount: 0,
};

function reviewContentLength(value: string) {
  return Array.from(value.trim()).length;
}

function canSubmitReview(
  grade: GradeView | null,
  rating: number,
  content: string,
) {
  return Boolean(grade) && rating > 0 && reviewContentLength(content) >= 8;
}

let activeSessionKey = "";
let catalogRequestSequence = 0;
let mineRequestSequence = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let sortMenuTimer: ReturnType<typeof setTimeout> | undefined;
let catalogCourses: CourseAssistantCourse[] = [];
let catalogCache = new Map<string, CatalogCacheEntry>();
let favoriteKeys = new Set<string>();
let selectedKeywords = new Set<string>();
let mineGrades: GradeView[] = [];
let courseTouchStart: TapPoint | null = null;
let courseTouchMoved = false;
let lastCourseScrollAt = 0;

function touchPoint(
  event: WechatMiniprogram.TouchEvent,
  changed = false,
): TapPoint | null {
  const touches = changed ? event.changedTouches : event.touches;
  const touch = touches[0];
  if (!touch) return null;
  return { x: Number(touch.clientX), y: Number(touch.clientY) };
}

function canActivateCourse() {
  const canActivate = canActivateTap(courseTouchMoved, lastCourseScrollAt);
  courseTouchStart = null;
  courseTouchMoved = false;
  return canActivate;
}

Page({
  data: {
    ...resolveAppearance(),
    statusLoading: true,
    statusError: "",
    reviewAccess: DEFAULT_REVIEW_ACCESS,
    activeTab: "browse" as AssistantTab,
    courseType: "general_elective" as CourseAssistantCourseType,
    searchQuery: "",
    filterOpen: false,
    selectedKeyword: "",
    catalogSort: "average_score" as CourseAssistantCatalogSort,
    catalogSortLabel: "历史均分",
    sortMenuMounted: false,
    sortMenuOpen: false,
    sortMenuTop: 0,
    sortMenuRight: 0,
    favoritesOnly: false,
    catalogLoading: false,
    catalogLoadingMore: false,
    catalogError: "",
    catalogPage: 1,
    catalogHasMore: true,
    courses: [] as CourseCardView[],
    summary: { courseCount: 0, reviewCount: 0, contributorCount: 0 },
    positiveFilterKeywords: DEFAULT_KEYWORDS.positive,
    mineLoading: false,
    mineError: "",
    takenCourses: [] as GradeView[],
    myReviews: [] as ReviewView[],
    reviewVisible: false,
    selectedGrade: null as GradeView | null,
    selectedRating: 0,
    ratingStars: starsFor(0),
    ratingHint: "点亮星星，给这门课一个总评",
    keywordOptions: keywordOptions(DEFAULT_KEYWORDS),
    reviewText: "",
    reviewCharacterCount: 0,
    reviewCanSubmit: false,
    reviewSubmitting: false,
  },
  onLoad(options: Record<string, string | undefined>) {
    if (!ensureAuthenticated()) return;
    activeSessionKey = "";
    catalogCourses = [];
    catalogCache = new Map();
    mineGrades = [];
    selectedKeywords = new Set();
    this.applyAppearance();
    if (options.tab === "publish") {
      this.setData({ activeTab: "publish" });
    }
    void this.loadAssistant(options.courseKey || "");
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.applyAppearance();
    const lease = captureSessionLease();
    if (!lease) return;
    const key = sessionLeaseKey(lease);
    if (activeSessionKey && activeSessionKey !== key) {
      catalogRequestSequence += 1;
      mineRequestSequence += 1;
      catalogCourses = [];
      catalogCache = new Map();
      mineGrades = [];
      this.setData({
        statusLoading: true,
        reviewAccess: DEFAULT_REVIEW_ACCESS,
        catalogSort: "average_score",
        catalogSortLabel: "历史均分",
        sortMenuMounted: false,
        sortMenuOpen: false,
        courses: [],
        catalogLoadingMore: false,
        catalogPage: 1,
        catalogHasMore: true,
        takenCourses: [],
        myReviews: [],
        reviewVisible: false,
      });
      void this.loadAssistant();
      return;
    }
    activeSessionKey = key;
    favoriteKeys = new Set(loadCourseAssistantFavorites(lease.account));
    this.applyCatalogView();
  },
  onUnload() {
    catalogRequestSequence += 1;
    mineRequestSequence += 1;
    if (searchTimer !== undefined) clearTimeout(searchTimer);
    searchTimer = undefined;
    if (sortMenuTimer !== undefined) clearTimeout(sortMenuTimer);
    sortMenuTimer = undefined;
  },
  applyAppearance() {
    const appearance = resolveAppearance();
    syncWindowBackground(appearance);
    this.setData(appearance);
  },
  async loadAssistant(pendingCourseKey = "") {
    const lease = captureSessionLease();
    if (!lease) return;
    activeSessionKey = sessionLeaseKey(lease);
    favoriteKeys = new Set(loadCourseAssistantFavorites(lease.account));
    this.setData({ statusLoading: true, statusError: "" });
    try {
      await Promise.all([this.loadCatalog(), this.loadMine()]);
      if (!isSessionLeaseCurrent(lease)) return;
      this.setData({ statusLoading: false });
      void this.prefetchCourseType(alternateCourseType(this.data.courseType));
      if (pendingCourseKey) this.openReviewFromDetail(pendingCourseKey);
    } catch (error) {
      if (!isSessionLeaseCurrent(lease)) return;
      this.setData({
        statusLoading: false,
        statusError: getErrorMessage(error, "选课助手加载失败。"),
      });
    }
  },
  retryStatus() {
    haptic("light");
    void this.loadAssistant();
  },
  async loadCatalog(append = false) {
    const lease = captureSessionLease();
    if (!lease) return;
    if (
      append &&
      (!this.data.catalogHasMore ||
        this.data.catalogLoading ||
        this.data.catalogLoadingMore)
    ) {
      return;
    }
    const request = ++catalogRequestSequence;
    const page = append ? this.data.catalogPage + 1 : 1;
    const cacheKey = catalogCacheKey(
      this.data.courseType,
      this.data.searchQuery,
      this.data.selectedKeyword,
      this.data.catalogSort,
    );
    this.setData({
      catalogLoading: !append && !catalogCourses.length,
      catalogLoadingMore: append,
      catalogError: "",
    });
    try {
      const result = await getCourseAssistantCatalog({
        page,
        pageSize: 100,
        type: this.data.courseType,
        q: this.data.searchQuery.trim() || undefined,
        keyword: this.data.selectedKeyword || undefined,
        sort: this.data.catalogSort,
      });
      if (request !== catalogRequestSequence || !isSessionLeaseCurrent(lease)) {
        return;
      }
      const eligibleCourses = result.items.filter(isEligibleCourse);
      catalogCourses = append
        ? mergeCatalogCourses(catalogCourses, eligibleCourses)
        : eligibleCourses;
      this.setData({
        catalogLoading: false,
        catalogLoadingMore: false,
        catalogPage: page,
        catalogHasMore: page < result.pagination.totalPages,
        summary: result.summary,
        positiveFilterKeywords: result.keywords.positive,
        reviewAccess: result.reviewAccess,
      });
      catalogCache.set(cacheKey, {
        courses: [...catalogCourses],
        page,
        hasMore: page < result.pagination.totalPages,
        summary: result.summary,
        positiveFilterKeywords: result.keywords.positive,
        reviewAccess: result.reviewAccess,
      });
      this.applyCatalogView();
    } catch (error) {
      if (request !== catalogRequestSequence || !isSessionLeaseCurrent(lease)) {
        return;
      }
      this.setData({
        catalogLoading: false,
        catalogLoadingMore: false,
        catalogError: getErrorMessage(error, "课程列表加载失败。"),
      });
      if (append) wx.showToast({ title: "继续加载失败", icon: "none" });
    }
  },
  loadMoreCatalog() {
    if (this.data.favoritesOnly) return;
    void this.loadCatalog(true);
  },
  applyCatalogView() {
    const courses = this.data.favoritesOnly
      ? catalogCourses.filter((course) => favoriteKeys.has(course.courseKey))
      : catalogCourses;
    this.setData({
      courses: courses.map((course, index) =>
        toCourseCard(
          course,
          index,
          this.data.reviewAccess.requiresContribution,
        ),
      ),
    });
  },
  retryCatalog() {
    haptic("light");
    void this.loadCatalog();
  },
  restoreCatalogCache() {
    const cached = catalogCache.get(
      catalogCacheKey(
        this.data.courseType,
        this.data.searchQuery,
        this.data.selectedKeyword,
        this.data.catalogSort,
      ),
    );
    if (!cached) return false;
    catalogCourses = [...cached.courses];
    this.setData({
      catalogLoading: false,
      catalogLoadingMore: false,
      catalogError: "",
      catalogPage: cached.page,
      catalogHasMore: cached.hasMore,
      summary: cached.summary,
      positiveFilterKeywords: cached.positiveFilterKeywords,
      reviewAccess: cached.reviewAccess,
    });
    this.applyCatalogView();
    return true;
  },
  async prefetchCourseType(type: CourseAssistantCourseType) {
    const lease = captureSessionLease();
    const searchQuery = this.data.searchQuery.trim();
    const selectedKeyword = this.data.selectedKeyword;
    const catalogSort = this.data.catalogSort;
    if (!lease || searchQuery || selectedKeyword) {
      return;
    }
    const cacheKey = catalogCacheKey(
      type,
      searchQuery,
      selectedKeyword,
      catalogSort,
    );
    if (catalogCache.has(cacheKey)) return;
    try {
      const result = await getCourseAssistantCatalog({
        page: 1,
        pageSize: 100,
        type,
        sort: catalogSort,
      });
      if (!isSessionLeaseCurrent(lease)) return;
      catalogCache.set(cacheKey, {
        courses: result.items.filter(isEligibleCourse),
        page: 1,
        hasMore: result.pagination.totalPages > 1,
        summary: result.summary,
        positiveFilterKeywords: result.keywords.positive,
        reviewAccess: result.reviewAccess,
      });
    } catch {
      // Prefetching is only a responsiveness optimization; normal loading
      // still reports actionable failures when the user selects this type.
    }
  },
  selectCourseType(event: WechatMiniprogram.TouchEvent) {
    const type = String(event.currentTarget.dataset.type || "");
    if (
      (type !== "general_elective" && type !== "physical_education") ||
      type === this.data.courseType
    ) {
      return;
    }
    haptic("light");
    catalogRequestSequence += 1;
    this.setData(
      {
        courseType: type,
        selectedKeyword: "",
        filterOpen: false,
        sortMenuMounted: false,
        sortMenuOpen: false,
        catalogPage: 1,
        catalogHasMore: true,
      },
      () => {
        if (this.restoreCatalogCache()) return;
        catalogCourses = [];
        this.setData({ courses: [] });
        void this.loadCatalog();
      },
    );
  },
  onSearchInput(event: WechatMiniprogram.Input) {
    const searchQuery = event.detail.value;
    this.closeSortMenu();
    this.setData({ searchQuery });
    if (searchTimer !== undefined) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTimer = undefined;
      catalogCourses = [];
      this.setData({ catalogPage: 1, catalogHasMore: true });
      void this.loadCatalog();
    }, 320);
  },
  toggleFavoritesOnly() {
    haptic("light");
    this.setData({ favoritesOnly: !this.data.favoritesOnly }, () =>
      this.applyCatalogView(),
    );
  },
  toggleFilter() {
    if (this.data.reviewAccess.requiresContribution) {
      this.setData({ activeTab: "publish" });
      return;
    }
    haptic("light");
    this.setData({ filterOpen: !this.data.filterOpen });
  },
  toggleSortMenu() {
    haptic("light");
    if (this.data.sortMenuMounted) {
      this.closeSortMenu();
      return;
    }
    if (sortMenuTimer !== undefined) {
      clearTimeout(sortMenuTimer);
      sortMenuTimer = undefined;
    }
    this.createSelectorQuery()
      .select("#course-sort-trigger")
      .boundingClientRect((rect) => {
        const windowWidth = wx.getWindowInfo().windowWidth || 375;
        const triggerRight = Number(rect?.right);
        const triggerBottom = Number(rect?.bottom);
        const fallbackInset = (42 * windowWidth) / 750;
        this.setData(
          {
            sortMenuTop: Number.isFinite(triggerBottom)
              ? triggerBottom + 6
              : 320,
            sortMenuRight: Number.isFinite(triggerRight)
              ? Math.max(fallbackInset, windowWidth - triggerRight)
              : fallbackInset,
            sortMenuMounted: true,
          },
          () => {
            wx.nextTick(() => {
              if (this.data.sortMenuMounted) {
                this.setData({ sortMenuOpen: true });
              }
            });
          },
        );
      })
      .exec();
  },
  closeSortMenu() {
    if (!this.data.sortMenuMounted) return;
    this.setData({ sortMenuOpen: false });
    if (sortMenuTimer !== undefined) clearTimeout(sortMenuTimer);
    sortMenuTimer = setTimeout(() => {
      if (!this.data.sortMenuOpen) {
        this.setData({ sortMenuMounted: false });
      }
      sortMenuTimer = undefined;
    }, 220);
  },
  selectCatalogSort(event: WechatMiniprogram.TouchEvent) {
    const sort = String(
      event.currentTarget.dataset.sort || "",
    ) as CourseAssistantCatalogSort;
    if (sort !== "average_score" && sort !== "rating") return;
    if (sort === "rating" && this.data.reviewAccess.ownReviewCount === 0) {
      haptic("light");
      this.closeSortMenu();
      wx.showToast({ title: "发布一条想法后可用", icon: "none" });
      return;
    }
    if (sort === this.data.catalogSort) {
      this.closeSortMenu();
      return;
    }
    haptic("light");
    this.closeSortMenu();
    catalogRequestSequence += 1;
    catalogCourses = [];
    this.setData(
      {
        catalogSort: sort,
        catalogSortLabel: sort === "rating" ? "学生评价" : "历史均分",
        courses: [],
        catalogPage: 1,
        catalogHasMore: true,
      },
      () => {
        if (this.restoreCatalogCache()) return;
        void this.loadCatalog();
      },
    );
  },
  selectFilterKeyword(event: WechatMiniprogram.TouchEvent) {
    const keyword = String(event.currentTarget.dataset.keyword || "");
    if (!keyword) return;
    haptic("light");
    catalogCourses = [];
    this.setData({
      selectedKeyword: keyword === this.data.selectedKeyword ? "" : keyword,
      courses: [],
      catalogPage: 1,
      catalogHasMore: true,
    });
    void this.loadCatalog();
  },
  clearFilterKeyword() {
    if (!this.data.selectedKeyword) return;
    catalogCourses = [];
    this.setData({
      selectedKeyword: "",
      courses: [],
      catalogPage: 1,
      catalogHasMore: true,
    });
    void this.loadCatalog();
  },
  toggleFavorite(event: WechatMiniprogram.TouchEvent) {
    if (!canActivateCourse()) return;
    const courseKey = String(event.currentTarget.dataset.key || "");
    const lease = captureSessionLease();
    if (!lease || !courseKey) return;
    haptic("light");
    favoriteKeys = new Set(
      toggleCourseAssistantFavorite(lease.account, courseKey),
    );
    this.applyCatalogView();
  },
  openCourse(event: WechatMiniprogram.TouchEvent) {
    if (!canActivateCourse()) return;
    const courseKey = String(event.currentTarget.dataset.key || "");
    if (!courseKey) return;
    haptic("light");
    void navigateTo(
      `/features/pages/course-assistant-detail/index?courseKey=${encodeURIComponent(courseKey)}`,
    );
  },
  switchTab(event: WechatMiniprogram.TouchEvent) {
    const tab = String(event.currentTarget.dataset.tab || "");
    if ((tab !== "browse" && tab !== "publish") || tab === this.data.activeTab)
      return;
    haptic("light");
    this.closeSortMenu();
    this.setData({ activeTab: tab });
    if (tab === "publish") void this.loadMine();
  },
  openPublishTab() {
    this.setData({ activeTab: "publish" });
    void this.loadMine();
  },
  async loadMine() {
    const lease = captureSessionLease();
    if (!lease) return;
    const request = ++mineRequestSequence;
    this.setData({ mineLoading: !mineGrades.length, mineError: "" });
    try {
      const result = await getMyCourseAssistantData();
      if (request !== mineRequestSequence || !isSessionLeaseCurrent(lease))
        return;
      mineGrades = result.grades.filter(isEligibleCourse).map(toGradeView);
      const eligibleCourseKeys = new Set(
        mineGrades.map((grade) => grade.courseKey),
      );
      this.setData({
        mineLoading: false,
        takenCourses: mineGrades,
        myReviews: result.reviews
          .filter((review) => {
            const courseKey = (review as ReviewView).courseKey;
            return !courseKey || eligibleCourseKeys.has(courseKey);
          })
          .map(toReviewView),
        keywordOptions: keywordOptions(result.keywords),
        reviewAccess: result.reviewAccess,
      });
    } catch (error) {
      if (request !== mineRequestSequence || !isSessionLeaseCurrent(lease))
        return;
      this.setData({
        mineLoading: false,
        mineError: getErrorMessage(error, "可评价课程加载失败。"),
      });
    }
  },
  retryMine() {
    haptic("light");
    void this.loadMine();
  },
  onCourseTouchStart(event: WechatMiniprogram.TouchEvent) {
    courseTouchStart = touchPoint(event);
    courseTouchMoved = false;
  },
  onCourseTouchMove(event: WechatMiniprogram.TouchEvent) {
    const current = touchPoint(event);
    if (
      courseTouchStart &&
      current &&
      movementExceedsTapThreshold(courseTouchStart, current)
    ) {
      courseTouchMoved = true;
    }
  },
  onCourseTouchEnd(event: WechatMiniprogram.TouchEvent) {
    const current = touchPoint(event, true);
    if (
      courseTouchStart &&
      current &&
      movementExceedsTapThreshold(courseTouchStart, current)
    ) {
      courseTouchMoved = true;
    }
    courseTouchStart = null;
  },
  onCourseTouchCancel() {
    courseTouchStart = null;
    courseTouchMoved = true;
  },
  onCourseScroll() {
    lastCourseScrollAt = Date.now();
    if (courseTouchStart) courseTouchMoved = true;
  },
  openReview(event: WechatMiniprogram.TouchEvent) {
    if (!canActivateCourse()) return;
    const courseKey = String(event.currentTarget.dataset.key || "");
    this.openReviewFromDetail(courseKey);
  },
  openReviewFromDetail(courseKey: string) {
    this.setData({ activeTab: "publish" });
    const grade = mineGrades.find((item) => item.courseKey === courseKey);
    if (!grade) {
      void this.loadMine().then(() => {
        const loaded = mineGrades.find((item) => item.courseKey === courseKey);
        if (loaded) this.prepareReview(loaded);
      });
      return;
    }
    this.prepareReview(grade);
  },
  prepareReview(grade: GradeView) {
    if (!isEligibleCourse(grade)) {
      wx.showToast({ title: "该体育课缺少项目名称，暂不可评价", icon: "none" });
      return;
    }
    if (grade.reviewed) {
      wx.showToast({ title: "这门课已经发表过想法", icon: "none" });
      return;
    }
    selectedKeywords = new Set();
    this.setData({
      reviewVisible: true,
      selectedGrade: grade,
      selectedRating: 0,
      ratingStars: starsFor(0),
      ratingHint: "点亮星星，给这门课一个总评",
      keywordOptions: this.data.keywordOptions.map((item) => ({
        ...item,
        active: false,
      })),
      reviewText: "",
      reviewCharacterCount: 0,
      reviewCanSubmit: false,
    });
  },
  closeReview() {
    if (this.data.reviewSubmitting) return;
    this.setData({ reviewVisible: false });
  },
  selectRating(event: WechatMiniprogram.TouchEvent) {
    const rating = Number(event.currentTarget.dataset.rating || 0);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return;
    haptic("light");
    this.setData({
      selectedRating: rating,
      ratingStars: starsFor(rating),
      ratingHint: `${rating}.0 星 · ${STAR_HINTS[rating]}`,
      reviewCanSubmit: canSubmitReview(
        this.data.selectedGrade,
        rating,
        this.data.reviewText,
      ),
    });
  },
  toggleReviewKeyword(event: WechatMiniprogram.TouchEvent) {
    const keyword = String(event.currentTarget.dataset.keyword || "");
    if (!keyword) return;
    if (selectedKeywords.has(keyword)) selectedKeywords.delete(keyword);
    else {
      if (selectedKeywords.size >= 5) {
        wx.showToast({ title: "关键词最多选 5 个", icon: "none" });
        return;
      }
      selectedKeywords.add(keyword);
    }
    haptic("light");
    this.setData({
      keywordOptions: this.data.keywordOptions.map((item) => ({
        ...item,
        active: selectedKeywords.has(item.text),
      })),
    });
  },
  onReviewTextInput(event: WechatMiniprogram.Input) {
    const reviewText = event.detail.value;
    const reviewCharacterCount = reviewContentLength(reviewText);
    this.setData({
      reviewText,
      reviewCharacterCount,
      reviewCanSubmit: canSubmitReview(
        this.data.selectedGrade,
        this.data.selectedRating,
        reviewText,
      ),
    });
  },
  async submitReview() {
    if (!this.data.reviewCanSubmit || this.data.reviewSubmitting) return;
    const lease = captureSessionLease();
    const grade = this.data.selectedGrade;
    if (!lease || !grade) return;
    haptic("heavy");
    this.setData({ reviewSubmitting: true });
    try {
      await publishCourseAssistantReview({
        courseKey: grade.courseKey,
        rating: this.data.selectedRating,
        keywords: [...selectedKeywords],
        content: this.data.reviewText.trim(),
      });
      if (!isSessionLeaseCurrent(lease)) return;
      this.setData({
        reviewSubmitting: false,
        reviewVisible: false,
        activeTab: "browse",
      });
      wx.showToast({ title: "感谢为后来同学指路", icon: "success" });
      catalogCache.clear();
      await Promise.all([this.loadCatalog(), this.loadMine()]);
      if (!isSessionLeaseCurrent(lease)) return;
      void navigateTo(
        `/features/pages/course-assistant-detail/index?courseKey=${encodeURIComponent(grade.courseKey)}`,
      );
    } catch (error) {
      if (!isSessionLeaseCurrent(lease)) return;
      this.setData({ reviewSubmitting: false });
      wx.showToast({
        title: getErrorMessage(error, "发布失败，请稍后重试。"),
        icon: "none",
        duration: 2600,
      });
    }
  },
  noop() {},
});

function toCourseCard(
  course: CourseAssistantCourse,
  index: number,
  thoughtsLocked: boolean,
): CourseCardView {
  return {
    ...course,
    indexLabel: String(index + 1).padStart(2, "0"),
    typeLabel: courseTypeLabel(course.type),
    teacherLabel: formatCourseTeacherNames(course.teacherNames),
    creditsLabel:
      course.credits === null
        ? "学分未提供"
        : `${formatCredits(course.credits)} 学分`,
    scoreLabel:
      course.averageScore === null ? "—" : course.averageScore.toFixed(1),
    ratingLabel: course.rating === null ? "暂无想法" : course.rating.toFixed(1),
    favorite: favoriteKeys.has(course.courseKey),
    stars: starsFor(course.rating || 0),
    thoughtsLocked,
  };
}

function toGradeView(grade: CourseAssistantGrade): GradeView {
  return {
    ...grade,
    typeLabel: courseTypeLabel(grade.type),
    scoreLabel: formatScore(grade.finalScore),
    metaLabel: [
      courseTypeLabel(grade.type),
      `${grade.termLabel}修读`,
      `成绩 ${formatScore(grade.finalScore)}`,
    ].join(" · "),
  };
}

function toReviewView(review: CourseAssistantReview): ReviewView {
  const value = review as CourseAssistantReview & {
    courseKey?: string;
    displayName?: string;
  };
  return {
    ...value,
    stars: starsFor(review.rating),
    visibleKeywords: review.keywords.slice(0, 3),
    remainingKeywordCount: Math.max(0, review.keywords.length - 3),
  };
}

function courseTypeLabel(type: CourseAssistantCourseType): string {
  return type === "physical_education" ? "体育课程" : "通识选修";
}

function alternateCourseType(
  type: CourseAssistantCourseType,
): CourseAssistantCourseType {
  return type === "general_elective"
    ? "physical_education"
    : "general_elective";
}

function catalogCacheKey(
  type: CourseAssistantCourseType,
  query: string,
  keyword: string,
  sort: CourseAssistantCatalogSort,
): string {
  return `${type}\u0000${query.trim()}\u0000${keyword}\u0000${sort}`;
}

function isEligibleCourse(
  course: Pick<CourseAssistantCourse, "type" | "sportName">,
): boolean {
  return (
    course.type !== "physical_education" || Boolean(course.sportName?.trim())
  );
}

function starsFor(rating: number): StarView[] {
  return [1, 2, 3, 4, 5].map((value) => ({
    value,
    active: rating >= value - 0.25,
  }));
}

function keywordOptions(groups: CourseAssistantKeywordGroups): KeywordOption[] {
  return (["positive", "neutral", "negative"] as KeywordSentiment[]).flatMap(
    (sentiment) =>
      (groups[sentiment] || []).map((text) => ({
        text,
        sentiment,
        active: false,
      })),
  );
}

function mergeCatalogCourses(
  current: CourseAssistantCourse[],
  incoming: CourseAssistantCourse[],
): CourseAssistantCourse[] {
  const merged = new Map(current.map((course) => [course.courseKey, course]));
  for (const course of incoming) merged.set(course.courseKey, course);
  return [...merged.values()];
}
