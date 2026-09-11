// The block a chapter opens on: its number, a mark, its title, a mark.
//
// Replaces what was a left-aligned meta line over the title set in the BODY
// face at 1.7× — which read as a large paragraph rather than as an opening,
// and whose meta line was a hardcoded English string. Centred now, with the
// title in an editorial display face and a fleuron closing each end.
//
// Chosen from two rounds of side-by-side mockups (layout first, then the two
// marks on their own). The marks are a real typographic form and not a shape
// that looked nice: a rule broken at its centre by a lozenge — the plainest
// fleuron there is — which stays legible at any measure because the ornament
// carries the weight rather than the line. The alternatives it beat were a
// swelled rule, an Oxford pair, a French rule with terminals, a tapering
// cul-de-lampe and an ʿunwān-style band.
//
// Everything here is centred, so nothing needs an RTL case: the marks are
// symmetric and the text centres itself.

import type { CSSProperties, ReactNode } from "react";
import type { MetricScript } from "../styles/fontMetrics";
import {
  FONT_CHAPTER_DISPLAY,
  FONT_READING_SANS,
  inkAlpha,
  type Theme,
} from "../styles/tokens";
import {
  chapterTitleApparent,
  chapterTitleSize,
  DESIGN_TITLE_APPARENT,
} from "./chapterTitleSize";
import { formatNum, type Locale } from "../i18n";
import type { Tr } from "../i18n";

interface Props {
  theme: Theme;
  /** 0-based position in the spine. */
  order: number;
  title: string;
  /** The body's size AFTER the per-face correction. The title is derived from
   *  it — see chapterTitleSize — and every other dimension here is derived
   *  from the TITLE, so the whole block keeps its proportions across the
   *  reader's 14–42px range and plateaus where the title does. */
  bodySize: number;
  /** Phone: a gentler growth rate and a lower plateau. Threaded from the
   *  reader that mounted BookBody, the same way ChapterEnd's is. */
  compact?: boolean;
  /** Script the BOOK is set in — the title is book content, so this follows
   *  the book's direction and not the UI language. The title face needs a
   *  different correction per script; without one the title is sized in the
   *  BODY face's terms while rendering in Markazi, which is ~24% smaller at
   *  the same px, so "a little bigger than the body" came out smaller. */
  script: MetricScript;
  tr: Tr;
  locale: Locale;
}

/**
 * A dimension of the block, scaled to the type it sits with.
 *
 * The marks were flat px values first, and the mockup at 13px came out
 * pixel-identical to the one at 17px — the size control did nothing to them at
 * all. That is wrong in both directions: a 26px arm is mean under 24px type
 * and heavy under 13px. In metal the compositor picked a rule to suit the size
 * and the measure; this is the same decision, made once.
 *
 * Scaled to the TITLE rather than to the body. The body version grew without
 * limit, so once the title started plateauing the rules kept going and the
 * block closed on 64px arms around a 40px title. Tying both to one number
 * means the whole opening stops growing together. DESIGN_TITLE_APPARENT is
 * the desktop default's title, so the values below still read as their
 * design values.
 */
const u = (apparentTitle: number, px: number) =>
  Math.round(((px * apparentTitle) / DESIGN_TITLE_APPARENT) * 10) / 10;

/** One arm of a mark. `w` may be a length or a percentage; it never centres
 *  itself, because every use here is a flex child and an auto inline margin on
 *  a flex item absorbs the free space rather than centring anything. */
function Arm({
  theme,
  w,
  alpha,
}: {
  theme: Theme;
  w: string | number;
  alpha: number;
}) {
  return (
    <span
      aria-hidden
      style={{
        display: "block",
        width: w,
        height: 1,
        background: inkAlpha(theme, alpha),
      }}
    />
  );
}

/** A lozenge — the plainest fleuron, and the one that survives text sizes
 *  where a floral ornament turns to mud. A rotated square rather than a glyph:
 *  no bundled face is guaranteed to carry ❧ or ⁂, and a missing one shows as
 *  tofu. */
function Lozenge({
  theme,
  size,
  alpha,
}: {
  theme: Theme;
  size: number;
  alpha: number;
}) {
  return (
    <span
      aria-hidden
      style={{
        display: "block",
        width: size,
        height: size,
        background: inkAlpha(theme, alpha),
        transform: "rotate(45deg)",
        flexShrink: 0,
      }}
    />
  );
}

function Mark({ gap, children }: { gap: number; children: ReactNode }) {
  return (
    <div
      aria-hidden
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap,
      }}
    >
      {children}
    </div>
  );
}

export function ChapterOpener({
  theme,
  order,
  title,
  bodySize,
  compact = false,
  script,
  tr,
  locale,
}: Props) {
  const titleSize = chapterTitleSize(bodySize, compact, script);
  // The rules and gaps key off the APPARENT title, not the px one, so a block
  // set in Arabic and one set in Latin close on the same rules.
  const apparentTitle = chapterTitleApparent(bodySize, compact);
  const px = (n: number) => u(apparentTitle, n);
  // Tracking and casing are Latin-only: Arabic is cursive, so letter-spacing
  // prises the joins apart, and there is no case to upper. The size bump
  // compensates for the presence it loses without the tracking. Same split the
  // focus running head and the first-run focus hint make.
  const arabic = locale === "ar";
  const meta: CSSProperties = {
    // Reading-surface meta label: the fixed reading sans, not the selectable
    // chrome font (var(--ui-font)) — this sits on the page, not in the chrome.
    fontFamily: FONT_READING_SANS,
    fontSize: arabic ? 12 : 10.5,
    fontWeight: 600,
    letterSpacing: arabic ? "normal" : "0.14em",
    textTransform: arabic ? "none" : "uppercase",
    color: theme.muted,
    marginBottom: px(10),
  };

  return (
    <div
      data-chapter-head
      style={{
        textAlign: "center",
        marginBottom: "1.6em",
        // A chapter opening that splits across a column boundary is not an
        // opening. Inherited from the block this replaced.
        breakInside: "avoid-column",
      }}
    >
      <div style={meta}>
        {/* The number alone. Over a chapter's own title the total is noise,
            and the bottom scrubber and focus mode's running head both still
            carry it. */}
        {tr("reader.chapterNumber", { n: formatNum(order + 1, locale) })}
      </div>

      <Mark gap={px(8)}>
        <Arm theme={theme} w={px(26)} alpha={0.24} />
        <Lozenge theme={theme} size={px(5)} alpha={0.42} />
        <Arm theme={theme} w={px(26)} alpha={0.24} />
      </Mark>

      <div
        style={{
          marginTop: px(15),
          // The editorial display face, carrying both scripts. The chapter's
          // name is the one place in the reading surface that should NOT be
          // the body face — that is what makes an opening read as an opening
          // rather than as a large paragraph.
          fontFamily: FONT_CHAPTER_DISPLAY,
          // Answers the reader's size choice, but plateaus — an unbounded
          // 1.8× put a 75px title on a phone at the top of the slider. See
          // chapterTitleSize for the three regimes, and for why the number is
          // computed in apparent size and converted back here.
          fontSize: titleSize,
          fontWeight: 400,
          color: theme.ink,
          lineHeight: 1.2,
        }}
      >
        {title}
      </div>

      {/* The foot is the same mark, wider and quieter: the arms reach out
          toward the measure instead of being cut to length, so the block
          closes on something proportional to the column rather than to the
          type. */}
      <div style={{ marginTop: px(17) }}>
        <Mark gap={px(11)}>
          <span style={{ flex: 1, maxWidth: px(150) }}>
            <Arm theme={theme} w="100%" alpha={0.18} />
          </span>
          <Lozenge theme={theme} size={px(4.5)} alpha={0.34} />
          <span style={{ flex: 1, maxWidth: px(150) }}>
            <Arm theme={theme} w="100%" alpha={0.18} />
          </span>
        </Mark>
      </div>
    </div>
  );
}
