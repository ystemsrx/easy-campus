import type {
  PassRateDistributionItem,
  PassRateScoreItem,
  PassRateStatistics,
} from "../../types/api";

interface DistributionView extends PassRateDistributionItem {
  height: number;
  mine: boolean;
}

interface ScoreView extends PassRateScoreItem {
  height: number;
  mine: boolean;
}

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
): DistributionView[] {
  const maximum = Math.max(
    0,
    ...statistics.distribution.map((item) => item.count),
  );
  const mine = scoreBand(ownScore);
  return statistics.distribution.map((item) => ({
    ...item,
    height: maximum ? Math.max(4, (item.count / maximum) * 100) : 0,
    mine: Boolean(mine) && item.band === mine,
  }));
}

function scoreViews(
  statistics: PassRateStatistics,
  ownScore: number,
): ScoreView[] {
  const maximum = Math.max(0, ...statistics.scores.map((item) => item.count));
  const mine = scoreLabel(ownScore);
  return statistics.scores.map((item) => ({
    ...item,
    height: maximum ? Math.max(4, (item.count / maximum) * 100) : 0,
    mine: Boolean(mine) && item.score === mine,
  }));
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
    theme: {
      type: String,
      value: "light",
      observer: "redrawRing",
    },
  },
  data: {
    distribution: [] as DistributionView[],
    scoreEntries: [] as ScoreView[],
    scoreChartWidth: 620,
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
          scoreChartWidth: 620,
        });
        return;
      }
      const ownScore = Number(this.data.ownScore);
      this.setData(
        {
          distribution: distributionViews(statistics, ownScore),
          scoreEntries: scoreViews(statistics, ownScore),
          scoreChartWidth: Math.max(620, statistics.scores.length * 38),
        },
        () => this.drawPassRing(statistics.passRate),
      );
    },
    redrawRing() {
      const statistics = this.data.statistics as PassRateStatistics | null;
      if (statistics) wx.nextTick(() => this.drawPassRing(statistics.passRate));
    },
    drawPassRing(passRate: number) {
      const query = this.createSelectorQuery();
      query.select("#pass-rate-ring-canvas").fields({ node: true, size: true });
      query.exec((results) => {
        const result = results[0] as {
          node?: WechatMiniprogram.Canvas;
          width?: number;
          height?: number;
        };
        const canvas = result?.node;
        const width = Number(result?.width || 0);
        const height = Number(result?.height || 0);
        if (!canvas || !width || !height) return;
        const pixelRatio = wx.getWindowInfo().pixelRatio || 1;
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
        const context = canvas.getContext("2d");
        context.scale(pixelRatio, pixelRatio);
        context.clearRect(0, 0, width, height);
        const lineWidth = (width * 17) / 184;
        const radius = Math.max(0, Math.min(width, height) / 2 - lineWidth / 2);
        const centerX = width / 2;
        const centerY = height / 2;
        context.lineWidth = lineWidth;
        context.lineCap = "round";
        context.beginPath();
        context.strokeStyle =
          this.data.theme === "dark"
            ? "rgba(255, 255, 255, 0.08)"
            : "rgba(43, 38, 32, 0.06)";
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.strokeStyle = "#7d8f6e";
        context.arc(
          centerX,
          centerY,
          radius,
          -Math.PI / 2,
          -Math.PI / 2 +
            Math.PI * 2 * (Math.max(0, Math.min(100, passRate)) / 100),
        );
        context.stroke();
      });
    },
  },
});
