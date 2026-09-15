import { apiRequest } from "../../services/request";
import type { CourseGrabOrder } from "../../services/course-grab";
export interface ServiceOrder {
  order_id: string; platform_name: string; amount_fen: number; billable_units: number; unit_price_fen: number;
  code_status: string; code_expires_at: number; payment_status: string; created_at: number; paid_at: number | null;
  payment_channel: string | null; payment_deadline: number | null;
  service_items: { id: string; name: string; quantity: number; billable_units: number }[];
  refunds: { id: string; status: string; amount_fen: number }[];
  fulfillment: { status: string; summary: string; version: number };
}
export const serviceStatus = (o: ServiceOrder) => {
  if (o.refunds.some((r) => r.status === "MANUAL_REQUIRED")) return "退款待售后处理";
  if (o.refunds.some((r) => ["PENDING", "PROCESSING"].includes(r.status))) return "退款处理中";
  const refunded = o.refunds.filter((r) => r.status === "SUCCEEDED").reduce((sum, r) => sum + r.amount_fen, 0);
  if (refunded) return refunded >= o.amount_fen ? "已退款" : "部分退款";
  if (o.payment_status === "PAID") return ({ NOT_STARTED: "已支付", QUEUED: "排队中", RUNNING: "执行中", SUCCEEDED: "已完成", PARTIAL: "部分完成", FAILED: "未完成", INTERRUPTED: "待核对" } as Record<string, string>)[o.fulfillment.status] || "已支付";
  return ({ UNPAID: "待支付", PROCESSING: "支付处理中", RECONCILING: "支付结果待确认", CLOSED: "已关闭" } as Record<string, string>)[o.payment_status] || "待查询";
};
export async function getServiceOrders(page: number) {
  const data = await apiRequest<{ items: ServiceOrder[]; hasMore: boolean }>(`/service-orders?page=${page}`);
  return { items: data.items.map((o) => ({ id: o.order_id, title: o.platform_name, planName: o.platform_name, planId: "service_unit_050", statusLabel: serviceStatus(o),
    amountCents: o.amount_fen, status: o.payment_status === "PAID" ? "paid" : "pending", credited: o.payment_status === "PAID",
    paidAt: o.paid_at ? new Date(o.paid_at).toISOString() : null, createdAt: new Date(o.created_at).toISOString(),
    outTradeNo: o.order_id, refundedCents: o.refunds.filter((r) => r.status === "SUCCEEDED").reduce((s, r) => s + r.amount_fen, 0),
    refunds: [], refund: { refundable: false, amountCents: 0, unavailableReason: null, requiresApple: false },
  } as CourseGrabOrder & { title: string; statusLabel: string })),
    pagination: { page, totalPages: data.hasMore ? page + 1 : page } };
}
