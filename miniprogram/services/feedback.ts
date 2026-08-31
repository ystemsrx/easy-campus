import type { FeedbackSubmission, FeedbackType } from "../types/api";
import { apiRequest } from "./request";

export function submitFeedback(input: {
  type: FeedbackType;
  content: string;
}): Promise<FeedbackSubmission> {
  return apiRequest<FeedbackSubmission>("/feedback", {
    method: "POST",
    data: input,
    retry: false,
    credentialReauthFeedback: true,
  });
}
