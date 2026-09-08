import type {
  CompanionPreferencesData,
  CourseAssistantReviewInput,
  ElectricityQuery,
  FeedbackSubmission,
  LocalScheduleData,
  Paginated,
  TeachingSuccess,
} from "../types/api";
import {
  demoCalendar,
  demoExams,
  demoGrades,
  demoMessages,
  demoNotices,
  demoPassRates,
  demoRoomOptions,
  demoRooms,
  demoSemester,
  demoTimetable,
  demoUser,
} from "./data";
import {
  DEMO_KEYWORDS,
  DEMO_REVIEW_ACCESS,
  demoAssistantCourses,
  demoOwnGrades,
  demoPublications,
} from "./community";
import { loadDemoState, saveDemoState } from "./state";
import { demoDormPayment } from "./dorm";

function parsePath(path: string): {
  route: string;
  query: Record<string, string>;
} {
  const [route, search = ""] = path.split("?");
  const query: Record<string, string> = {};
  search
    .split("&")
    .filter(Boolean)
    .forEach((pair) => {
      const [key, value = ""] = pair.split("=");
      query[decodeURIComponent(key)] = decodeURIComponent(
        value.replace(/\+/g, " "),
      );
    });
  return { route, query };
}

function paginate<T>(items: T[], query: Record<string, string>): Paginated<T> {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.max(1, Number(query.pageSize) || 200);
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    pagination: {
      page,
      pageSize,
      total: items.length,
      totalPages: Math.ceil(items.length / pageSize),
    },
  };
}

/** All demo requests terminate here. Unknown routes fail locally, never fall through. */
export function demoRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
): TeachingSuccess<T> {
  const { route, query } = parsePath(path);
  const state = loadDemoState();
  const now = new Date().toISOString();
  const result = (data: unknown): TeachingSuccess<T> => ({
    success: true,
    data: JSON.parse(JSON.stringify(data ?? null)) as T,
    meta: { cached: false, fetchedAt: now },
  });
  const save = (data: unknown) => {
    saveDemoState(state);
    return result(data);
  };
  if (route === "/auth/me")
    return result({ ...demoUser(), companion: state.companion });
  if (route === "/auth/status") return result(demoUser().credential);
  if (route === "/auth/heartbeat") return result({ alive: true });
  if (route === "/auth/logout")
    return result({ loggedOut: true, dataRetained: true });
  if (route === "/auth/watermark") return result(null);
  if (route === "/auth/companion" && method === "PUT") {
    state.companion = { ...(body as CompanionPreferencesData), updatedAt: now };
    return save(state.companion);
  }
  if (route === "/feedback" && method === "POST") {
    return result({
      ...(body as FeedbackSubmission),
      id: `demo-feedback-${Date.now()}`,
      createdAt: now,
    });
  }
  if (route === "/teaching/timetable") return result(demoTimetable());
  if (route === "/teaching/schedule") {
    if (method === "PUT") {
      state.schedule = body as LocalScheduleData;
      return save(state.schedule);
    }
    return result(state.schedule);
  }
  if (route === "/teaching/grades") {
    const grades = demoGrades();
    let items = grades.items.filter(
      (item) =>
        (!query.q || item.courseName.includes(query.q)) &&
        (!query.academicYear ||
          item.academicYear.startsWith(query.academicYear)) &&
        (!query.term || item.term === Number(query.term)),
    );
    if (query.sort) {
      const sort = query.sort;
      items = items.sort(
        (a, b) =>
          (sort === "finalScore"
            ? Number(a.finalScore) - Number(b.finalScore)
            : sort === "academicYear"
              ? a.academicYear.localeCompare(b.academicYear)
              : a.courseName.localeCompare(b.courseName)) *
          (query.order === "desc" ? -1 : 1),
      );
    }
    return result({ ...grades, ...paginate(items, query) });
  }
  if (route === "/teaching/grades/class-distribution")
    return result({
      status: "ready",
      distribution: [
        { score: 75, count: 5 },
        { score: 85, count: 15 },
        { score: 90, count: 20 },
        { score: 95, count: 10 },
      ],
    });
  if (route === "/teaching/pass-rates")
    return result(demoPassRates(query.courseKey || query.timetableCourseId));
  if (route === "/teaching/exams/options")
    return result({
      semesters: [demoSemester()],
      defaultSemester: demoSemester(),
    });
  if (route === "/teaching/exams") {
    const exams = demoExams();
    return result({ ...exams, ...paginate(exams.items, query) });
  }
  if (route === "/teaching/messages")
    return result(
      paginate(
        demoMessages().filter(
          (item) =>
            (!query.type || item.type === query.type) &&
            (!query.types || query.types.split(",").includes(item.type)) &&
            (!query.from || item.createdAt >= query.from) &&
            (!query.to || item.createdAt.slice(0, 10) <= query.to),
        ),
        query,
      ),
    );
  if (route === "/teaching/notices")
    return result(
      paginate(
        demoNotices().filter(
          (item) => !query.q || item.title.includes(query.q),
        ),
        query,
      ),
    );
  if (route === "/teaching/notices/detail")
    return result(
      demoNotices().find((item) => item.id === query.id) || demoNotices()[0],
    );
  if (route === "/teaching/calendar")
    return result(demoCalendar(Number(query.academicYear) || undefined));
  if (route === "/teaching/rooms/options") return result(demoRoomOptions());
  if (route === "/teaching/rooms") {
    const rooms = demoRooms(query);
    return result({ ...rooms, ...paginate(rooms.items, query) });
  }
  if (route === "/utilities/electricity/buildings")
    return result({
      buildings: [
        { id: "demo-dorm-1", name: "示例宿舍1栋" },
        { id: "demo-dorm-2", name: "示例宿舍2栋" },
      ],
    });
  if (route === "/utilities/electricity/account")
    return result(state.electricity);
  if (route === "/utilities/electricity/query" && method === "POST") {
    const input = body as ElectricityQuery;
    state.electricity = {
      ...state.electricity,
      accountFetchedAt: now,
      binding: {
        buildingId: input.buildingId,
        buildingName: input.buildingName || "示例宿舍1栋",
        roomNumber: input.roomNumber,
        boundAt: now,
        changedAt: now,
      },
    };
    return save(state.electricity);
  }
  if (route === "/content/feed") {
    const items = demoPublications().map((item) => ({
      ...item,
      isRead: state.readPublications.includes(item.id),
      readAt: state.readPublications.includes(item.id) ? now : null,
    }));
    return result({
      items,
      announcements: items.filter((item) => item.kind === "announcement"),
      notifications: items.filter((item) => item.kind === "notification"),
      unreadCount: items.filter((item) => !item.isRead).length,
    });
  }
  if (
    /^\/content\/publications\/[^/]+\/read$/.test(route) &&
    method === "POST"
  ) {
    const id = route.split("/")[3];
    if (!state.readPublications.includes(id)) state.readPublications.push(id);
    return save({ read: true, readAt: now });
  }
  if (
    /^\/content\/publications\/[^/]+\/popup$/.test(route) &&
    method === "POST"
  )
    return result({ recorded: true });
  if (route === "/auto-dorm-check/status") return result(state.dorm.status);
  if (route === "/auto-dorm-check/location")
    return result(state.dorm.status.checkInLocation);
  if (
    route === "/auto-dorm-check/preferences" ||
    route === "/auto-dorm-check/agreement"
  ) {
    const input = body as { enabled?: boolean; accepted?: boolean };
    const status = state.dorm.status;
    if (typeof input.enabled === "boolean") status.enabled = input.enabled;
    if (typeof input.accepted === "boolean") {
      status.agreementAccepted = input.accepted;
      status.agreementAcceptedAt = input.accepted ? now : null;
    }
    status.effectiveEnabled = status.enabled && status.agreementAccepted;
    status.checkInStatus = !status.agreementAccepted
      ? "agreement_required"
      : status.enabled
        ? "pending"
        : "disabled";
    status.updatedAt = now;
    return save(status);
  }
  if (route === "/auto-dorm-check/payment")
    return result(demoDormPayment(state.dorm.status.entitlement));
  if (route === "/auto-dorm-check/payment/orders" && method === "GET") {
    return result(
      paginate(
        state.dorm.orders.filter(
          (order) =>
            !query.status ||
            query.status === "all" ||
            order.status === query.status,
        ),
        query,
      ),
    );
  }
  if (route === "/auto-dorm-check/payment/orders" && method === "POST") {
    const input = body as { planId: string };
    const payment = demoDormPayment(state.dorm.status.entitlement);
    const plan = payment.plans.find((item) => item.id === input.planId);
    if (!plan) throw new Error("套餐不存在，请重新选择。");
    const id = `demo-order-local-${Date.now()}-${state.dorm.orders.length}`;
    const order = {
      id,
      planId: plan.id,
      planName: plan.name,
      outTradeNo: `DEMO${Date.now()}${state.dorm.orders.length}`,
      status: "paid" as const,
      credited: true,
      amountCents: plan.priceCents,
      refundedCents: 0,
      createdAt: now,
      paidAt: now,
      refunds: [],
    };
    state.dorm.orders.unshift(order);
    const entitlement = state.dorm.status.entitlement;
    if (plan.billingType === "time") {
      entitlement.time.remainingDays += plan.quotaAmount;
      entitlement.time.remainingSeconds += plan.quotaAmount * 86400;
    } else entitlement.uses.remaining += plan.quotaAmount;
    return save({ order, entitlement, payment: null });
  }
  if (route.startsWith("/auto-dorm-check/payment/orders/")) {
    const order = state.dorm.orders.find(
      (item) => item.id === decodeURIComponent(route.split("/")[4]),
    );
    if (!order) throw new Error("订单不存在，请刷新后重试。");
    return result({
      order,
      entitlement: state.dorm.status.entitlement,
      payment: null,
    });
  }
  if (route === "/course-assistant/courses") {
    const items = demoAssistantCourses(state.reviews).filter(
      (item) =>
        (!query.type || item.type === query.type) &&
        (!query.q || item.displayName.includes(query.q)) &&
        (!query.keyword ||
          item.keywords.some((keyword) => keyword.text === query.keyword)),
    );
    return result({
      ...paginate(items, query),
      summary: {
        courseCount: items.length,
        reviewCount: state.reviews.length,
        contributorCount: 60,
      },
      keywords: DEMO_KEYWORDS,
      reviewAccess: DEMO_REVIEW_ACCESS,
    });
  }
  if (route.startsWith("/course-assistant/courses/")) {
    return result(
      demoAssistantCourses(state.reviews).find(
        (course) =>
          course.courseKey === decodeURIComponent(route.split("/")[3]),
      ),
    );
  }
  if (route === "/course-assistant/mine")
    return result({
      grades: demoOwnGrades().map((grade) => {
        const review = state.reviews.find(
          (item) => item.own && item.courseKey === grade.courseKey,
        );
        return {
          ...grade,
          reviewed: Boolean(review),
          reviewId: review?.id || null,
          reviewUnderReview: false,
        };
      }),
      reviews: state.reviews.filter((item) => item.own),
      keywords: DEMO_KEYWORDS,
      reviewAccess: DEMO_REVIEW_ACCESS,
    });
  if (route === "/course-assistant/reviews" && method === "POST") {
    const input = body as CourseAssistantReviewInput;
    const grade =
      demoOwnGrades().find((item) => item.courseKey === input.courseKey) ||
      demoOwnGrades()[0];
    const review = {
      ...state.reviews[0],
      id: `demo-own-${input.courseKey}`,
      courseKey: input.courseKey,
      courseName: grade.courseName,
      displayName: grade.displayName,
      authorLabel: "我（匿名）" as const,
      own: true,
      rating: input.rating,
      content: input.content,
      keywords: input.keywords.map((text) => ({
        text,
        sentiment: "positive" as const,
      })),
      likeCount: 0,
      liked: false,
      createdAt: now,
    };
    state.reviews = [
      ...state.reviews.filter((item) => item.id !== review.id),
      review,
    ];
    return save(review);
  }
  if (
    /^\/course-assistant\/reviews\/[^/]+\/like$/.test(route) &&
    method === "POST"
  ) {
    const review = state.reviews.find(
      (item) => item.id === decodeURIComponent(route.split("/")[3]),
    );
    if (review) {
      review.liked = !review.liked;
      review.likeCount += review.liked ? 1 : -1;
    }
    return save({
      liked: review?.liked || false,
      likeCount: review?.likeCount || 0,
    });
  }
  throw new Error("示例账号暂不支持此操作。");
}
