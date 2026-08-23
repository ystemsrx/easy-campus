import type {
  PassRateDistributionItem,
  PassRateScoreItem,
  PassRateStatistics,
} from "../../types/api";

interface DistributionView extends PassRateDistributionItem {
  height: number;
  mine: boolean;
  valueLabel: string;
}

interface ScoreView extends PassRateScoreItem {
  height: number;
  mine: boolean;
}

interface PercentageAxisTick {
  value: number;
  label: string;
}

interface ScoreChartView {
  entries: ScoreView[];
  ticks: PercentageAxisTick[];
  barWidth: number;
  chartWidth: number;
}

const SCORE_CHART_VIEWPORT_WIDTH = 520;
const SCORE_BAR_GAP = 8;
const SCORE_BAR_MIN_WIDTH = 24;
const SCORE_BAR_MAX_WIDTH = 72;
const SCORE_AXIS_SEGMENTS = 4;

function scoreLabel(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 60) return "<60";
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(2)));
}

function scoreBand(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 60) return "<60";
  if (value < 70) return "60–69";
  if (value < 80) return "70–79";
  if (value < 90) return "80–89";
  return "90–100";
}

function distributionViews(
  statistics: PassRateStatistics,
  ownScore: number,
  percentageOnly: boolean,
): DistributionView[] {
  const maximum = Math.max(
    0,
    ...statistics.distribution.map((item) => item.count),
  );
  const mine = scoreBand(ownScore);
  const total = statistics.distribution.reduce(
    (sum, item) => sum + Math.max(0, item.count),
    0,
  );
  return statistics.distribution.map((item) => ({
    ...item,
    height: maximum ? Math.max(4, (item.count / maximum) * 100) : 0,
    mine: Boolean(mine) && item.band === mine,
    valueLabel: percentageOnly
      ? percentageLabel(total ? (Math.max(0, item.count) / total) * 100 : 0)
      : `${item.count}人`,
  }));
}

function scoreChartView(
  statistics: PassRateStatistics,
  ownScore: number,
): ScoreChartView {
  const scoreCount = statistics.scores.length;
  const total = statistics.scores.reduce(
    (sum, item) => sum + Math.max(0, item.count),
    0,
  );
  const maximumPercentage = total
    ? Math.max(
        0,
        ...statistics.scores.map(
          (item) => (Math.max(0, item.count) / total) * 100,
        ),
      )
    : 0;
  const axisStep = nicePercentageStep(maximumPercentage / SCORE_AXIS_SEGMENTS);
  const axisMaximum = axisStep * SCORE_AXIS_SEGMENTS;
  const mine = scoreLabel(ownScore);
  const desiredBarWidth = scoreCount
    ? (SCORE_CHART_VIEWPORT_WIDTH - SCORE_BAR_GAP * (scoreCount - 1)) /
      scoreCount
    : SCORE_BAR_MAX_WIDTH;
  const barWidth = Math.max(
    SCORE_BAR_MIN_WIDTH,
    Math.min(SCORE_BAR_MAX_WIDTH, desiredBarWidth),
  );
  const occupiedWidth =
    scoreCount * barWidth + Math.max(0, scoreCount - 1) * SCORE_BAR_GAP;
  return {
    entries: statistics.scores.map((item) => {
      const percentage = total ? (Math.max(0, item.count) / total) * 100 : 0;
      return {
        ...item,
        height: percentage ? Math.max(3, (percentage / axisMaximum) * 100) : 0,
        mine: Boolean(mine) && item.score === mine,
      };
    }),
    ticks: Array.from({ length: SCORE_AXIS_SEGMENTS + 1 }, (_item, index) => {
      const value = axisMaximum - axisStep * index;
      return { value, label: percentageLabel(value) };
    }),
    barWidth: Number(barWidth.toFixed(2)),
    chartWidth: Math.max(SCORE_CHART_VIEWPORT_WIDTH, Math.ceil(occupiedWidth)),
  };
}

function nicePercentageStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 25;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const multiplier = [1, 1.25, 2, 2.5, 5, 10].find(
    (candidate) => normalized <= candidate,
  );
  return (multiplier || 10) * magnitude;
}

function percentageLabel(value: number): string {
  const rounded = Number(value.toFixed(2));
  return `${rounded}%`;
}

function passRateRingSource(value: number, theme: string): string {
  const progress = Math.max(0, Math.min(100, Number(value) || 0));
  const circumference = 2 * Math.PI * 42;
  const progressLength = Number(((circumference * progress) / 100).toFixed(2));
  const remainderLength = Number((circumference - progressLength).toFixed(2));
  const trackColor = theme === "dark" ? "#ffffff" : "#2b2620";
  const trackOpacity = theme === "dark" ? 0.08 : 0.06;
  const animation = progress
    ? `<animate attributeName="stroke-dasharray" from="0 ${Number(circumference.toFixed(2))}" to="${progressLength} ${remainderLength}" dur=".65s" calcMode="spline" keyTimes="0;1" keySplines=".22 1 .36 1" fill="freeze"/>`
    : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<circle cx="50" cy="50" r="42" fill="none" stroke="${trackColor}" stroke-opacity="${trackOpacity}" stroke-width="9.24"/>` +
    `<circle cx="50" cy="50" r="42" fill="none" stroke="#7d8f6e" stroke-width="9.24" stroke-linecap="round" stroke-dasharray="${progressLength} ${remainderLength}" stroke-opacity="${progress ? 1 : 0}" transform="rotate(-90 50 50)">${animation}</circle>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

Component({
  properties: {
    statistics: {
      type: Object,
      value: null,
      observer: "refreshStatistics",
    },
    ownScore: {
      type: Number,
      value: -1,
      observer: "refreshStatistics",
    },
    displayScore: { type: String, value: "—" },
    showOwnScore: { type: Boolean, value: false },
    percentageOnly: {
      type: Boolean,
      value: false,
      observer: "refreshStatistics",
    },
    theme: {
      type: String,
      value: "light",
      observer: "refreshStatistics",
    },
  },
  data: {
    distribution: [] as DistributionView[],
    scoreEntries: [] as ScoreView[],
    scoreAxisTicks: [] as PercentageAxisTick[],
    scoreBarWidth: SCORE_BAR_MAX_WIDTH,
    scoreChartWidth: SCORE_CHART_VIEWPORT_WIDTH,
    passRingSource: passRateRingSource(0, "light"),
    passedLabel: "0 人",
    failedLabel: "0 人",
  },
  lifetimes: {
    ready() {
      this.refreshStatistics();
    },
  },
  methods: {
    refreshStatistics() {
      const statistics = this.data.statistics as PassRateStatistics | null;
      if (!statistics) {
        this.setData({
          distribution: [],
          scoreEntries: [],
          scoreAxisTicks: [],
          scoreBarWidth: SCORE_BAR_MAX_WIDTH,
          scoreChartWidth: SCORE_CHART_VIEWPORT_WIDTH,
          passRingSource: passRateRingSource(0, String(this.data.theme)),
          passedLabel: "0 人",
          failedLabel: "0 人",
        });
        return;
      }
      const ownScore = Number(this.data.ownScore);
      const percentageOnly = Boolean(this.data.percentageOnly);
      const total = Math.max(0, Number(statistics.totalCount) || 0);
      const scoreChart = scoreChartView(statistics, ownScore);
      this.setData({
        distribution: distributionViews(
          statistics,
          ownScore,
          percentageOnly,
        ),
        scoreEntries: scoreChart.entries,
        scoreAxisTicks: scoreChart.ticks,
        scoreBarWidth: scoreChart.barWidth,
        scoreChartWidth: scoreChart.chartWidth,
        passRingSource: passRateRingSource(
          statistics.passRate,
          String(this.data.theme),
        ),
        passedLabel: percentageOnly
          ? percentageLabel(
              total ? (Math.max(0, statistics.passedCount) / total) * 100 : 0,
            )
          : `${statistics.passedCount} 人`,
        failedLabel: percentageOnly
          ? percentageLabel(
              total ? (Math.max(0, statistics.failedCount) / total) * 100 : 0,
            )
          : `${statistics.failedCount} 人`,
      });
    },
  },
});
