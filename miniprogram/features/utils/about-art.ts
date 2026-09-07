type DrawingContext =
  WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D;
type PathCommand =
  | ["M" | "L", number, number]
  | ["C", number, number, number, number, number, number]
  | ["Z"];

interface ArtPath {
  fill?: string;
  stroke?: string;
  width?: number;
  commands: PathCommand[];
}

// Shared geometry for the page SVG and the exported personal print.
export const REST_ART: ArtPath[] = [
  {
    stroke: "#7b965b",
    width: 1.2,
    commands: [
      ["M", 51, 174],
      ["C", 111, 250, 361, 143, 397, 31],
    ],
  },
  {
    fill: "#153d30",
    commands: [
      ["M", 361, 31],
      ["C", 265, 3, 129, 36, 83, 119],
      ["C", 23, 226, 192, 282, 328, 225],
      ["C", 368, 208, 403, 178, 427, 143],
      ["C", 380, 177, 319, 191, 263, 184],
      ["C", 181, 174, 144, 135, 176, 86],
      ["C", 206, 45, 286, 23, 361, 31],
      ["Z"],
    ],
  },
  {
    fill: "#718e50",
    commands: [
      ["M", 427, 143],
      ["C", 365, 216, 239, 246, 139, 200],
      ["C", 217, 221, 332, 209, 427, 143],
      ["Z"],
    ],
  },
  {
    fill: "#dc9851",
    commands: [
      ["M", 302, 61],
      ["C", 308, 80, 316, 86, 337, 85],
      ["C", 319, 94, 314, 102, 316, 124],
      ["C", 307, 105, 299, 100, 278, 102],
      ["C", 295, 91, 300, 84, 302, 61],
      ["Z"],
    ],
  },
  {
    fill: "#153d30",
    commands: [
      ["M", 363, 46],
      ["L", 369, 53],
      ["L", 367, 63],
      ["L", 361, 56],
      ["Z"],
    ],
  },
];

export function drawRestArt(context: DrawingContext): void {
  for (const path of REST_ART) {
    context.beginPath();
    for (const command of path.commands) {
      if (command[0] === "M") context.moveTo(command[1], command[2]);
      else if (command[0] === "L") context.lineTo(command[1], command[2]);
      else if (command[0] === "C")
        context.bezierCurveTo(
          command[1],
          command[2],
          command[3],
          command[4],
          command[5],
          command[6],
        );
      else context.closePath();
    }
    if (path.fill) {
      context.fillStyle = path.fill;
      context.fill();
    }
    if (path.stroke) {
      context.strokeStyle = path.stroke;
      context.lineWidth = path.width || 1;
      context.stroke();
    }
  }
}
