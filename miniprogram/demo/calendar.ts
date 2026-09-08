/** Render a dated example locally so calendar preview/save also work offline. */
export function renderDemoCalendar(year: number): Promise<string> {
  const width = 1000;
  const height = 1370;
  const canvas = wx.createOffscreenCanvas({ type: "2d", width, height });
  const context = canvas.getContext("2d");
  context.fillStyle = "#faf9f6";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#24342d";
  context.font = "bold 38px sans-serif";
  context.fillText(`${year}-${year + 1} 学年校历`, 52, 70);
  context.fillStyle = "#688274";
  context.font = "22px sans-serif";
  context.fillText("示例校历", 52, 108);
  const now = new Date();
  for (let index = 0; index < 12; index++) {
    const month = new Date(year, 8 + index, 1);
    const x = 52 + (index % 3) * 314;
    const y = 168 + Math.floor(index / 3) * 284;
    context.fillStyle = "#24342d";
    context.font = "bold 24px sans-serif";
    context.fillText(`${month.getFullYear()}年${month.getMonth() + 1}月`, x, y);
    context.font = "18px sans-serif";
    context.fillStyle = "#6d7c73";
    ["一", "二", "三", "四", "五", "六", "日"].forEach((label, column) =>
      context.fillText(label, x + column * 39, y + 36),
    );
    const offset = (month.getDay() + 6) % 7;
    const days = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0,
    ).getDate();
    for (let day = 1; day <= days; day++) {
      const cell = offset + day - 1;
      const dx = x + (cell % 7) * 39;
      const dy = y + 72 + Math.floor(cell / 7) * 30;
      const today =
        now.getFullYear() === month.getFullYear() &&
        now.getMonth() === month.getMonth() &&
        now.getDate() === day;
      if (today) {
        context.fillStyle = "#dce9df";
        context.fillRect(dx - 6, dy - 22, 36, 28);
      }
      context.fillStyle = cell % 7 >= 5 ? "#b57960" : "#24342d";
      context.fillText(String(day), dx, dy);
    }
  }
  context.fillStyle = "#688274";
  context.font = "20px sans-serif";
  context.fillText("第一学期 · 9月—1月     第二学期 · 2月—8月", 52, 1330);
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      width,
      height,
      destWidth: width,
      destHeight: height,
      fileType: "png",
      success: ({ tempFilePath }) => resolve(tempFilePath),
      fail: reject,
    });
  });
}
