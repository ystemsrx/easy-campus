import type {
  AutoDormCheckEntitlement,
  AutoDormCheckOrderHistoryItem,
  AutoDormCheckPaymentData,
} from "../types/api";
import { demoTimestamp } from "./data";

export function demoDormPayment(
  entitlement: AutoDormCheckEntitlement,
): AutoDormCheckPaymentData {
  return {
    paymentEnabled: true,
    accessGranted: true,
    accessMode: entitlement.time.remainingDays > 0 ? "time" : "count",
    entitlement,
    plans: [
      {
        id: "demo-month",
        name: "30 天套餐",
        billingType: "time",
        priceCents: 600,
        priceLabel: "¥6.00",
        quotaUnit: "day",
        quotaAmount: 30,
        quotaLabel: "30 天",
        description: "连续 30 天",
      },
      {
        id: "demo-count",
        name: "10 次套餐",
        billingType: "count",
        priceCents: 300,
        priceLabel: "¥3.00",
        quotaUnit: "count",
        quotaAmount: 10,
        quotaLabel: "10 次",
        description: "不限时间，用完为止",
      },
    ],
  };
}

export function demoDormOrders(): AutoDormCheckOrderHistoryItem[] {
  return Array.from({ length: 24 }, (_, index) => {
    const timePlan = index % 2 === 0;
    const amountCents = timePlan ? 600 : 300;
    const date = demoTimestamp(-2 - index * 9, 18);
    const refundedCents = index === 2 ? 600 : index === 4 ? 200 : 0;
    const status =
      index === 3
        ? "cancelled"
        : index === 5
          ? "pending"
          : index === 7
            ? "failed"
            : "paid";
    return {
      id: `demo-order-${index}`,
      planId: timePlan ? "demo-month" : "demo-count",
      planName: timePlan ? "30 天套餐" : "10 次套餐",
      outTradeNo: `DEMO${date.replace(/\D/g, "").slice(0, 14)}${String(index).padStart(4, "0")}`,
      status,
      credited: status === "paid",
      amountCents,
      refundedCents,
      createdAt: date,
      paidAt: status === "paid" ? date : null,
      refunds: refundedCents
        ? [
            {
              id: `demo-refund-${index}`,
              status: "success",
              amountCents: refundedCents,
            },
          ]
        : index === 6
          ? [{ id: "demo-refund-pending", status: "processing", amountCents }]
          : [],
    };
  });
}
