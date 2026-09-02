import {
  getCourseAssistantCourse,
  toggleCourseAssistantReviewLike,
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
  CourseAssistantCourseDetail,
  CourseAssistantHistoryItem,
  CourseAssistantReview,
} from "../../../types/api";
import {
  resolveAppearance,
  syncWindowBackground,
} from "../../../utils/appearance";
import {
  formatCourseTeacherNames,
  formatReviewTeacherNames,
} from "../../utils/course-assistant";
import { formatDateTime } from "../../../utils/date";
import { formatCredits } from "../../../utils/format";
import { haptic } from "../../../utils/haptics";
import { ensureAuthenticated, navigateTo } from "../../../utils/navigation";

interface StarView {
  value: number;
  active: boolean;
}

interface DistributionView {
  label: string;
  count: number;
  percentage: number;
  widthLabel: string;
}

interface HistoryView extends CourseAssistantHistoryItem {
  scoreLabel: string;
  shortLabel: string;
  x: number;
  y: number;
  scoreY: number;
  peak: boolean;
}

interface HistorySegmentView {
  left: number;
  top: number;
  width: number;
  angle: number;
}

interface HistoryAxisTickView {
  label: string;
  y: number;
}

interface ReviewView extends CourseAssistantReview {
  stars: StarView[];
  scoreLabel: string;
  studyLabel: string;
  createdLabel: string;
  likePending: boolean;
}

interface DetailView extends CourseAssistantCourseDetail {
  typeLabel: string;
  typeKicker: string;
  teacherLabel: string;
  creditsLabel: string;
  averageLabel: string;
  ratingLabel: string;
  recommendationLabel: string;
  stars: StarView[];
  distributions: DistributionView[];
  historyRows: HistoryView[];
  historySegments: HistorySegmentView[];
  historyAxisTicks: HistoryAxisTickView[];
  historyRangeLabel: string;
  reviewRows: ReviewView[];
  ownReviewUnderReview: boolean;
}

interface CourseAssistantHostPage {
  route?: string;
  openReviewFromDetail?: (courseKey: string) => void;
  openPublishTab?: () => void;
}

let courseKey = "";
let activeSessionKey = "";
let loadSequence = 0;

Page({
  data: {
    ...resolveAppearance(),
    loading: true,
    error: "",
    detail: null as DetailView | null,
    favorite: false,
  },
  onLoad(options: Record<string, string | undefined>) {
    if (!ensureAuthenticated()) return;
    courseKey = String(options.courseKey || "").trim();
    if (!/^[a-f0-9]{64}$/.test(courseKey)) {
      this.setData({ loading: false, error: "课程链接无效，请返回后重试。" });
      return;
    }
    this.applyAppearance();
    void this.loadDetail();
  },
  onShow() {
    if (!ensureAuthenticated()) return;
    this.applyAppearance();
    const lease = captureSessionLease();
    if (!lease) return;
    const key = sessionLeaseKey(lease);
    if (activeSessionKey && key !== activeSessionKey) {
      activeSessionKey = key;
      this.setData({ detail: null, loading: true, error: "" });
      void this.loadDetail();
      return;
    }
    activeSessionKey = key;
    this.setData({
      favorite: loadCourseAssistantFavorites(lease.account).includes(courseKey),
    });
  },
  onUnload() {
    loadSequence += 1;
  },
  applyAppearance() {
    const appearance = resolveAppearance();
    syncWindowBackground(appearance);
    this.setData(appearance);
  },
  async loadDetail() {
    const lease = captureSessionLease();
    if (!lease || !courseKey) return;
    activeSessionKey = sessionLeaseKey(lease);
    const request = ++loadSequence;
    this.setData({ loading: !this.data.detail, error: "" });
    try {
      const result = await getCourseAssistantCourse(courseKey);
      if (request !== loadSequence || !isSessionLeaseCurrent(lease)) return;
      this.setData({
        loading: false,
        detail: toDetailView(result),
        favorite: loadCourseAssistantFavorites(lease.account).includes(
          courseKey,
        ),
      });
    } catch (error) {
      if (request !== loadSequence || !isSessionLeaseCurrent(lease)) return;
      this.setData({
        loading: false,
        error: getErrorMessage(error, "课程详情加载失败。"),
      });
    }
  },
  retry() {
    haptic("light");
    void this.loadDetail();
  },
  toggleFavorite() {
    const lease = captureSessionLease();
    if (!lease || !courseKey) return;
    haptic("light");
    const favorites = toggleCourseAssistantFavorite(lease.account, courseKey);
    const favorite = favorites.includes(courseKey);
    this.setData({ favorite });
    wx.showToast({
      title: favorite ? "已收藏" : "已取消收藏",
      icon: "none",
    });
  },
  async toggleLike(event: WechatMiniprogram.TouchEvent) {
    const reviewId = String(event.currentTarget.dataset.id || "");
    const detail = this.data.detail;
    if (!reviewId || !detail) return;
    const rowIndex = detail.reviewRows.findIndex(
      (item) => item.id === reviewId,
    );
    if (
      rowIndex < 0 ||
      detail.reviewRows[rowIndex].underReview ||
      detail.reviewRows[rowIndex].likePending
    )
      return;
    const lease = captureSessionLease();
    if (!lease) return;
    haptic("light");
    this.setData({ [`detail.reviewRows[${rowIndex}].likePending`]: true });
    try {
      const result = await toggleCourseAssistantReviewLike(reviewId);
      if (!isSessionLeaseCurrent(lease)) return;
      this.setData({
        [`detail.reviewRows[${rowIndex}].liked`]: result.liked,
        [`detail.reviewRows[${rowIndex}].likeCount`]: result.likeCount,
        [`detail.reviewRows[${rowIndex}].likePending`]: false,
      });
    } catch (error) {
      if (!isSessionLeaseCurrent(lease)) return;
      this.setData({ [`detail.reviewRows[${rowIndex}].likePending`]: false });
      wx.showToast({
        title: getErrorMessage(error, "操作失败，请稍后重试。"),
        icon: "none",
      });
    }
  },
  goPublish() {
    const detail = this.data.detail;
    if (!detail?.canReview) return;
    haptic("medium");
    const pages = getCurrentPages() as CourseAssistantHostPage[];
    const host = pages[pages.length - 2];
    if (
      host?.route === "features/pages/course-assistant/index" &&
      typeof host.openReviewFromDetail === "function"
    ) {
      host.openReviewFromDetail(courseKey);
      wx.navigateBack();
      return;
    }
    void navigateTo(
      `/features/pages/course-assistant/index?tab=publish&courseKey=${encodeURIComponent(courseKey)}`,
    );
  },
  goContribute() {
    haptic("medium");
    const pages = getCurrentPages() as CourseAssistantHostPage[];
    const host = pages[pages.length - 2];
    if (
      host?.route === "features/pages/course-assistant/index" &&
      typeof host.openPublishTab === "function"
    ) {
      host.openPublishTab();
      wx.navigateBack();
      return;
    }
    void navigateTo("/features/pages/course-assistant/index?tab=publish");
  },
});

function toDetailView(detail: CourseAssistantCourseDetail): DetailView {
  const history = plottableHistory(detail.history);
  const historyChart = historyChartView(history);
  return {
    ...detail,
    typeLabel: detail.type === "physical_education" ? "体育课程" : "通识选修",
    typeKicker:
      detail.type === "physical_education"
        ? "PHYSICAL EDUCATION"
        : "GENERAL EDUCATION",
    teacherLabel: formatCourseTeacherNames(detail.teacherNames),
    creditsLabel:
      detail.credits === null
        ? "学分未提供"
        : `${formatCredits(detail.credits)} 学分`,
    averageLabel:
      detail.averageScore === null ? "—" : detail.averageScore.toFixed(1),
    ratingLabel: detail.rating === null ? "—" : detail.rating.toFixed(1),
    recommendationLabel:
      detail.recommendationRate === null
        ? "—"
        : `${Math.round(detail.recommendationRate)}%`,
    stars: starsFor(detail.rating || 0),
    distributions: detail.distribution.map((item) => ({
      ...item,
      widthLabel: `${Math.max(0, Math.min(100, item.percentage))}%`,
    })),
    historyRows: historyChart.points,
    historySegments: historyChart.segments,
    historyAxisTicks: historyChart.axisTicks,
    historyRangeLabel: historyRangeLabel(history),
    reviewRows: detail.reviews.map(toReviewView),
    ownReviewUnderReview: detail.reviews.some(
      (review) => review.own && review.underReview,
    ),
  };
}

function historyRangeLabel(history: CourseAssistantHistoryItem[]): string {
  if (!history.length) return "";
  const first = history[0].label;
  const last = history[history.length - 1].label;
  return first === last ? first : `${first} — ${last}`;
}

function shortSemesterLabel(label: string): string {
  return label.replace(/^(\d{2})(\d{2})\s*/, "$2");
}

function plottableHistory(
  history: CourseAssistantHistoryItem[],
): CourseAssistantHistoryItem[] {
  return history.filter(
    (item) =>
      typeof item.averageScore === "number" &&
      Number.isFinite(item.averageScore),
  );
}

function historyChartView(history: CourseAssistantHistoryItem[]): {
  points: HistoryView[];
  segments: HistorySegmentView[];
  axisTicks: HistoryAxisTickView[];
} {
  if (!history.length) return { points: [], segments: [], axisTicks: [] };
  const chartWidth = 500;
  const left = 18;
  const right = chartWidth - 18;
  const top = 0;
  const bottom = 180;
  const axisSegments = 4;
  const scores = history.map((item) => Number(item.averageScore));
  const observedMin = Math.min(...scores);
  const observedMax = Math.max(...scores);
  const padding = Math.max(2, (observedMax - observedMin) * 0.2);
  let minimum = Math.max(0, Math.floor((observedMin - padding) / 5) * 5);
  let maximum = Math.min(100, Math.ceil((observedMax + padding) / 5) * 5);
  if (maximum - minimum < 10) {
    minimum = Math.max(0, minimum - 5);
    maximum = Math.min(100, maximum + 5);
  }
  const span = Math.max(1, maximum - minimum);
  const peakIndex = scores.lastIndexOf(observedMax);
  const coordinates = scores.map((score, index) => ({
    x:
      scores.length === 1
        ? (left + right) / 2
        : left + (index * (right - left)) / (scores.length - 1),
    y: bottom - ((score - minimum) / span) * (bottom - top),
  }));
  const points = history.map((item, index) => ({
    ...item,
    scoreLabel: scores[index].toFixed(1),
    shortLabel: shortSemesterLabel(item.label),
    x: Number(coordinates[index].x.toFixed(2)),
    y: Number(coordinates[index].y.toFixed(2)),
    scoreY: Number(Math.max(0, coordinates[index].y - 32).toFixed(2)),
    peak: index === peakIndex,
  }));
  const segments = coordinates.slice(0, -1).map((point, index) => {
    const next = coordinates[index + 1];
    const deltaX = next.x - point.x;
    const deltaY = next.y - point.y;
    return {
      left: Number(point.x.toFixed(2)),
      top: Number((point.y - 2).toFixed(2)),
      width: Number(Math.hypot(deltaX, deltaY).toFixed(2)),
      angle: Number(((Math.atan2(deltaY, deltaX) * 180) / Math.PI).toFixed(2)),
    };
  });
  const axisTicks = Array.from({ length: axisSegments + 1 }, (_, index) => {
    const value = maximum - (span * index) / axisSegments;
    return {
      label: Number.isInteger(value) ? String(value) : value.toFixed(1),
      y: Number((top + (index * (bottom - top)) / axisSegments).toFixed(2)),
    };
  });
  return { points, segments, axisTicks };
}

function toReviewView(review: CourseAssistantReview): ReviewView {
  return {
    ...review,
    stars: starsFor(review.rating),
    scoreLabel:
      review.calculationScore === null
        ? "成绩未量化"
        : `成绩 ${review.calculationScore.toFixed(1)}`,
    studyLabel: `${review.termLabel.replace(/\s+/g, "")} 学期修读（${formatReviewTeacherNames(review.teacherNames)}）`,
    createdLabel: review.createdAt ? formatDateTime(review.createdAt) : "",
    likePending: false,
  };
}

function starsFor(rating: number): StarView[] {
  return [1, 2, 3, 4, 5].map((value) => ({
    value,
    active: rating >= value - 0.25,
  }));
}
