/// <reference types="miniprogram-api-typings" />

interface IAppOption {
  globalData: {
    session: import("../miniprogram/types/api").Session | null;
    user: import("../miniprogram/types/api").CurrentUserData | null;
    preferences: import("../miniprogram/types/app").AppPreferences;
    selectedGrade: import("../miniprogram/types/api").GradeCourse | null;
    foregroundEntryId: number;
  };
}
