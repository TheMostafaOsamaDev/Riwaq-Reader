import {
  FONT_SERIF_DISPLAY,
  FONT_STACKS,
  type Theme,
  type ThemeKey,
} from "../styles/tokens";
import { useI18n } from "../i18n/useI18n";
import { chapterStartTicks } from "../reader/bookProgress";

interface Props {
  theme: Theme;
  themeKey: ThemeKey;
  /** Whole percent through the book, as the reader measured it — the same
   *  number its bar shows. See reader/bookProgress.ts. */
  percent: number;
  currentChapter: number;
  chapterCount: number;
  chapterTitle: string;
}

export function ProgressOverlay({
  theme,
  themeKey,
  percent,
  currentChapter,
  chapterCount,
  chapterTitle,
}: Props) {
  const { tr, locale } = useI18n();
  const isAr = locale === "ar";
  const chaptersLeft = Math.max(0, chapterCount - currentChapter - 1);

  const shadow = themeKey === "light" ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.5)";

  // Where each chapter after the first begins, on the same scale as the
  // percent above.
  const ticks = chapterStartTicks(chapterCount, Number.POSITIVE_INFINITY);

  return (
    <div
      style={{
        background: theme.chrome,
        color: theme.ink,
        borderRadius: 14,
        padding: 22,
        minWidth: 340,
        boxShadow: `0 20px 60px ${shadow}`,
        border: `0.5px solid ${theme.rule}`,
        fontFamily: FONT_STACKS.sans,
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: isAr ? "normal" : "0.08em",
          textTransform: isAr ? "none" : "uppercase",
          color: theme.muted,
          marginBottom: 14,
        }}
      >
        {tr("reader.readingProgress")}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontFamily: FONT_SERIF_DISPLAY,
            fontSize: 42,
            fontWeight: 400,
            color: theme.ink,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {percent}
        </span>
        <span style={{ fontSize: 18, color: theme.muted, fontWeight: 400 }}>
          %
        </span>
        <span
          style={{
            fontSize: 11,
            color: theme.muted,
            marginInlineStart: "auto",
          }}
        >
          {tr("progress.ofBook")}
        </span>
      </div>

      <div
        style={{
          fontSize: 12,
          color: theme.muted,
          marginBottom: 16,
          lineHeight: 1.4,
        }}
      >
        <span
          style={{
            fontFamily: FONT_SERIF_DISPLAY,
            color: theme.ink,
          }}
        >
          {chapterTitle}
        </span>
        {" · "}
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {tr("progress.chapterOfTotal", {
            n: currentChapter + 1,
            total: chapterCount,
          })}
        </span>
        {chaptersLeft > 0 && (
          <>
            {" · "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              {tr("progress.chaptersLeft", { n: chaptersLeft })}
            </span>
          </>
        )}
      </div>

      <div
        style={{
          position: "relative",
          height: 6,
          background: theme.rule,
          borderRadius: 3,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${percent}%`,
            background: theme.ink,
            borderRadius: 3,
          }}
        />
        {ticks.map((p, i) => (
          <span
            key={i}
            style={{
              position: "absolute",
              insetInlineStart: `${p * 100}%`,
              top: -3,
              width: 1.5,
              height: 12,
              background: theme.muted,
              opacity: 0.5,
            }}
          />
        ))}
      </div>
    </div>
  );
}
