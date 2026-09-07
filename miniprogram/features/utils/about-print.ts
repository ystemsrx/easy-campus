import { APP_NAME } from "../../config/app";
import { drawRestArt } from "./about-art";
import type { buildVisitWall } from "./visit-wall";

type DrawingContext =
  WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
export type VisitWall = ReturnType<typeof buildVisitWall>;
export interface AboutPrint {
  wall: VisitWall;
}

// Stay below the documented 1365 × 1365 Canvas 2D limit, without multiplying by DPR.
export const PRINT_WIDTH = 900;
export const PRINT_HEIGHT = 1350;
const INK = "#153d30";
const PAPER = "#f4f2e9";
const COLORS = ["#e3e7da", "#c4d8a3", "#8cb76a", "#4e894e", "#24583c"];
const MINI_PROGRAM_CODE = "/features/assets/mini-program-code.jpg";

function trackedText(
  context: DrawingContext,
  text: string,
  x: number,
  y: number,
  tracking: number,
): void {
  for (const character of Array.from(text)) {
    context.fillText(character, x, y);
    x += context.measureText(character).width + tracking;
  }
}

function square(
  context: DrawingContext,
  x: number,
  y: number,
  size: number,
  radius: number,
  color: string,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + size - radius, y);
  context.quadraticCurveTo(x + size, y, x + size, y + radius);
  context.lineTo(x + size, y + size - radius);
  context.quadraticCurveTo(x + size, y + size, x + size - radius, y + size);
  context.lineTo(x + radius, y + size);
  context.quadraticCurveTo(x, y + size, x, y + size - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function drawPoster(context: DrawingContext): void {
  context.save();
  context.translate(450, 441);
  context.rotate((-5 * Math.PI) / 180);
  context.scale(0.94, 0.94);
  context.translate(-253, -383);
  context.shadowColor = "rgba(29, 47, 26, 0.18)";
  context.shadowBlur = 26;
  context.shadowOffsetX = 7;
  context.shadowOffsetY = 17;
  context.fillStyle = "#d6ea8d";
  context.fillRect(0, 0, 506, 766);
  context.shadowColor = "transparent";
  context.fillStyle = INK;
  context.font = "bold 15px sans-serif";
  trackedText(context, "EASY SWU", 28, 43, 1);
  context.font = "bold 10px sans-serif";
  trackedText(context, "FOR CAMPUS LIFE", 338, 43, 1);
  context.font = "italic 104px Georgia, serif";
  trackedText(context, "take it", 38, 171, -5);
  context.font = "italic bold 174px Georgia, serif";
  trackedText(context, "easy.", 28, 355, -12);
  context.save();
  context.translate(28, 410);
  drawRestArt(context);
  context.restore();
  context.strokeStyle = "rgba(21, 61, 48, 0.45)";
  context.lineWidth = 0.8;
  context.beginPath();
  context.moveTo(28, 693);
  context.lineTo(478, 693);
  context.stroke();
  context.fillStyle = INK;
  context.font = "bold 23px sans-serif";
  trackedText(context, "校园生活，轻一点。", 28, 732, 2);
  context.font = "bold 10px sans-serif";
  trackedText(context, "LESS RUSH.", 394, 714, 1);
  trackedText(context, "MORE LIFE.", 394, 730, 1);
  context.restore();
}

export function drawAboutPrint(
  context: DrawingContext,
  print: AboutPrint,
  miniProgramCode: WechatMiniprogram.Image,
): void {
  context.clearRect(0, 0, PRINT_WIDTH, PRINT_HEIGHT);
  context.fillStyle = PAPER;
  context.fillRect(0, 0, PRINT_WIDTH, PRINT_HEIGHT);
  context.textBaseline = "alphabetic";
  context.textAlign = "left";
  context.fillStyle = INK;
  context.font = "bold 27px sans-serif";
  context.fillText(APP_NAME, 72, 59);
  context.textAlign = "right";
  context.font = "15px sans-serif";
  context.fillText("把时间，还给校园。", 828, 57);
  context.textAlign = "left";
  drawPoster(context);

  context.fillStyle = "#74796a";
  context.textAlign = "right";
  context.font = "16px sans-serif";
  context.fillText(print.wall.today.replace(/-/g, "."), 780, 867);
  context.textAlign = "left";
  context.font = "16px sans-serif";
  print.wall.months.forEach((month, column) => {
    context.fillText(month.label, 148 + column * 44, 917);
  });
  print.wall.rows.forEach((row, rowIndex) => {
    context.fillStyle = "#74796a";
    context.fillText(row.label, 116, 954 + rowIndex * 44);
    row.days.forEach((day, column) => {
      if (!day.future)
        square(
          context,
          148 + column * 44,
          931 + rowIndex * 44,
          34,
          9,
          COLORS[day.level] || COLORS[0],
        );
    });
  });
  COLORS.forEach((color, index) =>
    square(context, 368 + index * 26, 1260, 18, 5, color),
  );
  context.fillStyle = "#74796a";
  context.font = "17px sans-serif";
  context.fillText("校园很大，日子慢慢来。", 116, 1310);

  // Multiply removes the white matte against the opaque paper while preserving
  // black code marks and their geometry. Keep the source image intact and upright.
  context.save();
  context.globalCompositeOperation = "multiply";
  context.drawImage(miniProgramCode, 520, 950, 260, 260);
  context.restore();
}

export function exportAboutPrint(print: AboutPrint): Promise<string> {
  // Offscreen 2D works independently of Skyline's page-level canvas support.
  const canvas = wx.createOffscreenCanvas({
    type: "2d",
    width: PRINT_WIDTH,
    height: PRINT_HEIGHT,
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    let image: WechatMiniprogram.Image | undefined;
    const finish = (error?: unknown, path?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (image) {
        image.onload = () => undefined;
        image.onerror = () => undefined;
      }
      canvas.width = 1;
      canvas.height = 1;
      if (error) reject(error);
      else if (path) resolve(path);
      else reject(new Error("图片生成失败"));
    };
    const timeout = setTimeout(() => finish(new Error("图片生成超时")), 10000);
    try {
      // Decode with this canvas before exporting so a slow/failed image load
      // cannot produce a seemingly successful poster with a missing code.
      const code = canvas.createImage();
      image = code;
      code.onload = () => {
        if (settled) return;
        try {
          drawAboutPrint(canvas.getContext("2d"), print, code);
          wx.canvasToTempFilePath({
            canvas,
            width: PRINT_WIDTH,
            height: PRINT_HEIGHT,
            destWidth: PRINT_WIDTH,
            destHeight: PRINT_HEIGHT,
            fileType: "png",
            success: ({ tempFilePath }) => finish(undefined, tempFilePath),
            fail: (error) => finish(error),
          });
        } catch (error) {
          finish(error);
        }
      };
      code.onerror = () => finish(new Error("小程序码加载失败"));
      code.src = MINI_PROGRAM_CODE;
    } catch (error) {
      finish(error);
    }
  });
}
