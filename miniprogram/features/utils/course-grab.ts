export function parseKeywords(input: string, max = 20): string[] {
  const result = [
    ...new Set(
      input
        .normalize("NFKC")
        .split(/[,，]/u)
        .map((value) => value.replace(/\s/gu, "").toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (result.length > max || result.some((value) => value.length > 100))
    throw new Error(`最多填写 ${max} 个关键词`);
  return result;
}
const pad = (n: number) => String(n).padStart(2, "0");
export function localMinute(value: Date) {
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: `${pad(value.getHours())}:${pad(value.getMinutes())}`,
  };
}
export function scheduledInstant(date: string, time: string, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    throw new Error("请选择日期和时间");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const value = new Date(year, month - 1, day, hour, minute);
  if (
    value.getFullYear() !== year ||
    value.getMonth() !== month - 1 ||
    value.getDate() !== day ||
    value.getHours() !== hour ||
    value.getMinutes() !== minute ||
    value.getTime() <= now
  )
    throw new Error("请选择当前时间之后的日期和分钟");
  return value.toISOString();
}
export function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
}
export const stateLabel: Record<string, string> = {
  disabled: "已关闭",
  paused: "已暂停",
  pending: "等待抢课",
  warming: "准备中",
  retrying: "等待重试",
  submitting: "抢课中",
  checking: "抢课中",
  uncertain: "结果确认中",
  succeeded: "已抢到",
  failed: "未抢到，次数已返还，可申请退款",
  expired: "时间已过，请重新配置",
};
export function timeLabel(iso: string) {
  const value = localMinute(new Date(iso));
  return `${value.date} ${value.time}`;
}
