import { saveAutoDormCheckSnapshot } from "../store/auto-dorm-check";
import { saveElectricitySnapshot } from "../store/electricity";
import { saveExamsSnapshot } from "../store/exams";
import { saveGradesSnapshot } from "../store/grades";
import { storeScheduleData } from "../store/schedule";
import {
  hasStoredPetPreferences,
  storeServerPetPreferences,
} from "../store/pet";
import { getSession, saveCurrentUser } from "../store/session";
import { saveTeachingPreview } from "../store/teaching-preview";
import { saveTimetableSnapshot } from "../store/timetable";
import {
  demoDate,
  demoExams,
  demoGrades,
  demoMessages,
  demoNotices,
  demoTimetable,
  demoUser,
} from "./data";
import { isDemoSession } from "./identity";
import { loadDemoState } from "./state";

let preparedDay = "";

/** Seed before any page hydrates its cache. Rebuild each local day and app launch. */
export function prepareDemoData(app?: IAppOption): boolean {
  const session = app ? app.globalData.session : getSession();
  if (!isDemoSession(session)) return false;
  const day = demoDate();
  if (preparedDay === day) return false;
  const state = loadDemoState();
  const timestamp = new Date().toISOString();
  if (!hasStoredPetPreferences("demo") && state.companion) {
    storeServerPetPreferences("demo", state.companion);
  }
  saveCurrentUser({ ...demoUser(), companion: state.companion }, app);
  const timetable = demoTimetable();
  saveTimetableSnapshot("demo", timetable, {
    serverFetchedAt: timestamp,
    replaceSemesterCatalog: true,
  });
  saveTimetableSnapshot("demo", timetable, {
    serverFetchedAt: timestamp,
    semesterId: timetable.semester.id,
  });
  saveGradesSnapshot("demo", demoGrades(), timestamp);
  saveExamsSnapshot("demo", demoExams(), {
    serverFetchedAt: timestamp,
    lastAutomaticRefreshAt: Date.now(),
  });
  storeScheduleData("demo", state.schedule);
  saveElectricitySnapshot("demo", state.electricity, timestamp);
  saveTeachingPreview(
    "demo",
    { messages: demoMessages(), notices: demoNotices() },
    { fetchedAt: timestamp },
  );
  saveAutoDormCheckSnapshot("demo", state.dorm.status);
  preparedDay = day;
  return true;
}
