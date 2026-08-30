import {
  resolveAppearance,
  syncWindowBackground,
} from "../../utils/appearance";
import {
  LEGAL_CONTACT_EMAIL,
  legalDocument,
  type LegalDocumentType,
} from "./content";

function documentType(value?: string): LegalDocumentType {
  return value === "privacy" ? "privacy" : "terms";
}

Page({
  data: {
    theme: "light" as "light" | "dark",
    themeClass: "theme-light",
    visualTheme: "default",
    visualThemeClass: "theme-style-default",
    motionClass: "motion-normal",
    document: legalDocument("terms"),
    contactEmail: LEGAL_CONTACT_EMAIL,
  },
  onLoad(query?: Record<string, string | undefined>) {
    const selectedType = documentType(query?.document);
    this.setData({
      document: legalDocument(selectedType),
    });
    this.applyAppearance();
  },
  onShow() {
    this.applyAppearance();
  },
  applyAppearance() {
    const appearance = resolveAppearance();
    syncWindowBackground(appearance);
    this.setData(appearance);
  },
});
