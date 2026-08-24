export type IdentityCardTone = "male" | "female" | "neutral";

const MALE_GENDERS = new Set(["男", "男性", "男生", "male", "man", "m", "1"]);
const FEMALE_GENDERS = new Set([
  "女",
  "女性",
  "女生",
  "female",
  "woman",
  "f",
  "2",
]);

export function identityCardTone(gender?: string): IdentityCardTone {
  const normalized = (gender || "").trim().toLowerCase();
  if (MALE_GENDERS.has(normalized)) return "male";
  if (FEMALE_GENDERS.has(normalized)) return "female";
  return "neutral";
}
