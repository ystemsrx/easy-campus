import type { AutoDormCheckOrderHistoryItem } from "../../types/api";
import { formatDateTime, localDateKey } from "../../utils/date";

export interface OrderView extends AutoDormCheckOrderHistoryItem {
  monthLabel: string;
  paidLabel: string;
  amountLabel: string;
  statusLabel: string;
  statusTone: "success" | "warning" | "muted" | "danger";
  refundLabel: string;
  paymentLabel: string;
}

export function orderViews(
  items: AutoDormCheckOrderHistoryItem[],
): OrderView[] {
  let previousMonth = "";
  return items.map((item) => {
    const timestamp = item.paidAt || item.createdAt;
    const date = localDateKey(timestamp);
    const month = date.slice(0, 7);
    const monthLabel =
      month !== previousMonth
        ? month
          ? `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`
          : "更早的订单"
        : "";
    previousMonth = month;
    const refunded = Math.max(0, item.refundedCents || 0);
    const processing = item.refunds.some(
      (refund) => refund.status === "pending" || refund.status === "processing",
    );
    const refundIssue = item.refunds.some(
      (refund) => refund.status === "abnormal",
    );
    const fullyRefunded = refunded >= item.amountCents && refunded > 0;
    return {
      ...item,
      paymentLabel:
        item.paymentChannel === "apple_iap"
          ? "Apple 支付"
          : item.paymentChannel === "wechat"
            ? "微信支付"
            : "虚拟支付",
      monthLabel,
      paidLabel: formatDateTime(timestamp),
      amountLabel: (item.amountCents / 100).toFixed(2),
      statusLabel:
        item.status === "cancelled"
          ? "已取消"
          : item.status === "failed"
            ? "支付失败"
            : item.status === "pending"
              ? "待支付"
              : processing
                ? "退款中"
                : fullyRefunded
                  ? "已退款"
                  : refunded > 0
                    ? "部分退款"
                    : refundIssue
                      ? "退款处理中"
                      : item.credited
                        ? "已支付"
                        : "额度到账中",
      statusTone:
        item.status === "cancelled"
          ? "muted"
          : item.status === "failed"
            ? "danger"
            : item.status === "pending" ||
                processing ||
                refundIssue ||
                !item.credited
              ? "warning"
              : refunded > 0
                ? "muted"
                : "success",
      refundLabel: refunded > 0 ? `已退 ¥${(refunded / 100).toFixed(2)}` : "",
    };
  });
}
