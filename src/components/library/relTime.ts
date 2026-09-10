
import type { Tr } from "../../i18n";

export function relTime(ts: number, tr: Tr): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return tr("library.justNow");
  if (m < 60) return tr("library.minAgo", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return tr("library.hourAgo", { n: h });
  const d = Math.floor(h / 24);
  if (d < 7) return tr("library.dayAgo", { n: d });
  const w = Math.floor(d / 7);
  if (w < 5) return tr("library.weekAgo", { n: w });
  const mo = Math.floor(d / 30);
  return tr("library.monthAgo", { n: mo });
}

// ── queue icon button (header) ─────────────────────────────────────────────
//
// Subscribes to the download queue so the badge reflects in-flight
// jobs in real time. Same visual shape in desktop + mobile headers.
