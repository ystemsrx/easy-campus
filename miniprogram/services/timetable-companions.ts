import { apiRequest } from "./request";
import type { TimetableData } from "../types/api";

export interface CompanionPerson {
  id: number;
  name: string;
  studentId: string;
  gender?: string;
  requestId?: number;
}
export interface CompanionState {
  code: string;
  partners: CompanionPerson[];
  requests: CompanionPerson[];
}

export const getCompanions = () => apiRequest<CompanionState>("/teaching/companions");
export const rotateCompanionCode = () => apiRequest<{ code: string }>("/teaching/companions/code", { method: "POST", data: {} });
export const bindCompanion = (code: string) => apiRequest<object>("/teaching/companions/bind", { method: "POST", data: { code } });
export const removeCompanion = (id: number) => apiRequest<object>(`/teaching/companions/${id}`, { method: "DELETE", data: {} });
export const decideCompanion = (id: number, decision: "accept" | "reject") =>
  apiRequest<object>(`/teaching/companions/requests/${id}/${decision}`, { method: "POST", data: {} });
export const getCompanionTimetable = (id: number, semester: string) =>
  apiRequest<TimetableData | null>(`/teaching/companions/${id}/timetable?semester=${encodeURIComponent(semester)}`);
