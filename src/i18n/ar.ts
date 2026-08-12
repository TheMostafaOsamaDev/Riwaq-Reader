import type { Messages } from "./index";

// Arabic UI catalog. Typed as `Messages` so a missing/renamed key from en.ts
// is a compile-time error. Keep key order in sync with en.ts for readability.
export const ar: Messages = {
  "common.close": "إغلاق",
  "common.cancel": "إلغاء",
  "common.back": "رجوع",
  "common.done": "تم",
  "common.delete": "حذف",
  "common.retry": "إعادة المحاولة",

  "settings.title": "القراءة",
  "settings.subtitle": "المظهر والخطوط",
  "settings.language": "اللغة",
  "settings.language.auto": "تلقائي",
  "settings.language.en": "English",
  "settings.language.ar": "العربية",
  "settings.theme": "السمة",
  "settings.theme.system": "النظام",
  "settings.theme.systemHint": "يتبع إعداد الفاتح / الداكن في نظامك",
  "settings.font": "الخط",
  "settings.fontSize": "حجم الخط · {n}ب",
  "settings.lineHeight": "ارتفاع السطر · {n}",
  "settings.letterSpacing": "تباعد الأحرف · {n}م",
  "settings.contentWidth": "عرض المحتوى · {n}٪",
  "settings.alignment": "المحاذاة",
  "settings.align.auto": "تلقائي",
  "settings.readingMode": "وضع القراءة",
  "settings.mode.paginated2": "صفحتان",
  "settings.mode.paginated1": "صفحة واحدة",
  "settings.mode.scroll": "تمرير",
  "settings.tapToTurn": "انقر لتقليب الصفحات",
  "settings.on": "تشغيل",
  "settings.off": "إيقاف",
  "settings.tapZoneWidth": "عرض منطقة النقر · {n}٪",
  "settings.tapStride": "مسافة تمرير النقرة · {n}٪",

  "app.loadingBook": "جارٍ تحميل الكتاب…",
  "panel.close": "إغلاق اللوحة",
};
