import type {
  CompanionPreferencesData,
  CourseAssistantReview,
  ElectricityCachedData,
  LocalScheduleData,
} from "../types/api";
import { demoDate, demoElectricity, demoSchedule } from "./data";
import { demoReviews, normalizeDemoCourseKey } from "./community";

// This namespace belongs only to the local demo; no real account reads it.
const KEY = "easy-swu:demo-state:v1";
export interface DemoState {
  day: string;
  schedule: LocalScheduleData;
  electricity: ElectricityCachedData;
  companion: CompanionPreferencesData | null;
  reviews: CourseAssistantReview[];
  readPublications: string[];
}

let memory: DemoState | null = null;
export function loadDemoState(): DemoState {
  const day = demoDate();
  if (memory?.day === day) return memory;
  const stored = wx.getStorageSync(KEY) as DemoState | undefined;
  memory =
    stored?.day === day &&
    Array.isArray(stored.schedule?.plans) &&
    Array.isArray(stored.reviews)
      ? stored
      : {
          day,
          schedule: demoSchedule(),
          electricity: demoElectricity(),
          companion: {
            selected: true,
            skipped: false,
            enabled: true,
            enhanced: false,
            shape: "blob",
            color: "#111214",
            updatedAt: new Date().toISOString(),
          },
          reviews: demoReviews(),
          readPublications: [],
        };
  let migrated = false;
  memory.reviews = memory.reviews.map((review) => {
    const courseKey = normalizeDemoCourseKey(review.courseKey || "");
    if (!review.courseKey || courseKey === review.courseKey) return review;
    migrated = true;
    return {
      ...review,
      courseKey,
      id:
        review.id === `demo-own-${review.courseKey}`
          ? `demo-own-${courseKey}`
          : review.id,
    };
  });
  if (migrated) saveDemoState(memory);
  return memory;
}

export function saveDemoState(state: DemoState): void {
  memory = state;
  try {
    wx.setStorageSync(KEY, state);
  } catch {
    /* Keep local interactions usable when storage is full. */
  }
}
