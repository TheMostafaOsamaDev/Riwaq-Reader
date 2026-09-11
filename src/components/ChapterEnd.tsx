import { useState } from "react";
import { Icon } from "./Icon";
import {
  FONT_CHAPTER_DISPLAY,
  FONT_READING_SANS,
  FONT_STACKS,
  inkAlpha,
  type Theme,
} from "../styles/tokens";
import { formatNum } from "../i18n";
import type { Tr } from "../i18n";
import { useI18n } from "../i18n/useI18n";

/**
 * The end of a chapter, and the way out of it.
 *
 * Until now the reader rendered NOTHING after a chapter's last paragraph: no
 * end marker, and no way forward except a hidden wheel gesture, the arrow
 * keys, the scrubber or the table of contents. A reader who did not know the
 * gesture had no visible way to continue, and the gesture itself had to be
 * made expensive (up to five notches of deliberate push) purely to keep an
 * invisible action from firing by accident.
 *
 * Making the turn visible is what let that expense go. The card carries the
 * intent, so the gesture no longer has to prove it — see turnGate.
 *
 * Interaction differs by platform on purpose. Desktop can click, press
 * Enter/Space, or simply keep scrolling past the card. Mobile is tap only:
 * touch momentum keeps delivering scroll events after the finger has left the
 * glass, and letting those turn chapters is precisely how one flick used to
 * cross three of them.
 */

/** Shared press state. Changes fill only — never layout, so nothing moves
 *  under a thumb that is already on the target. */
function usePressed() {
  const [pressed, setPressed] = useState(false);
  return [
    pressed,
    {
      onPointerDown: () => setPressed(true),
      onPointerUp: () => setPressed(false),
      onPointerLeave: () => setPressed(false),
      onPointerCancel: () => setPressed(false),
    },
  ] as const;
}

/** Forward in the book points LEFT in an RTL layout; rtl-flip-x does that to
 *  a directional glyph, and leaves it alone in LTR. */
function Forward({ size }: { size: number }) {
  return <Icon name="chevronR" size={size} className="rtl-flip-x" />;
}

interface EndProps {
  theme: Theme;
  tr: Tr;
  /** Phone sizing: bigger targets, tighter gutters. */
  compact?: boolean;
  /** Title of the next chapter, or null at the end of the book. */
  nextTitle: string | null;
  /** 1-based number of the next chapter. */
  nextNumber: number;
  total: number;
  /** Whether the next chapter is already on the device. Omitted when unknown —
   *  better to say nothing than to guess, since it predicts a wait. */
  availability?: "device" | "online";
  onNext: () => void;
  /** The two marginal moves. Both stay available at the end of the BOOK, where
   *  there is no turn left to take but every reason to want the contents. */
  onOpenToc: () => void;
  onTopOfChapter: () => void;
}

/**
 * A marginal link: a secondary move set in the page's own voice.
 *
 * Not a button-shaped button. These sit outside the card on bare paper, and
 * the moment they take a fill or a border they start competing with the turn
 * — which is the one thing on this block that should look like a control. An
 * underline is what a reader already reads as "follow this", and it costs no
 * box.
 *
 * The 44px height is padding around an 11.5px line, so the target clears the
 * platform minimum while the INK stays marginal. Hit area and visual weight
 * are different things, and this is the case that most tempts you to conflate
 * them.
 */
function MarginalLink({
  theme,
  label,
  onClick,
}: {
  theme: Theme;
  label: string;
  onClick: () => void;
}) {
  const [pressed, press] = usePressed();
  return (
    <button
      onClick={onClick}
      {...press}
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 44,
        padding: "0 6px",
        border: "none",
        background: "transparent",
        color: pressed ? theme.ink : theme.muted,
        font: "inherit",
        fontFamily: FONT_STACKS.sans,
        fontSize: 11.5,
        fontWeight: 600,
        textDecoration: "underline",
        textUnderlineOffset: 3,
        textDecorationColor: inkAlpha(theme, pressed ? 0.5 : 0.28),
        cursor: "pointer",
        transition:
          "color 120ms ease-out, text-decoration-color 120ms ease-out",
      }}
    >
      {label}
    </button>
  );
}

export function ChapterEndCard({
  theme,
  tr,
  compact = false,
  nextTitle,
  nextNumber,
  total,
  availability,
  onNext,
  onOpenToc,
  onTopOfChapter,
}: EndProps) {
  const [pressed, press] = usePressed();
  const { locale } = useI18n();
  const arabic = locale === "ar";
  const gutter = compact ? 20 : 40;

  return (
    <div
      style={{
        maxWidth: compact ? "none" : 660,
        margin: "0 auto",
        // The phone's bottom padding has to clear the bottom chrome, which is
        // position:absolute and OVERLAYS the scroll area rather than
        // displacing it. Measured on device: the chrome is 124px tall and the
        // scroller contributes 44px of its own, so the 56px that used to be
        // here left the last 24px of the marginal links underneath it. That
        // was survivable while the foot of this block was a caption; these are
        // controls now, and a control you cannot tap at the exact moment you
        // have scrolled to it is not a control.
        //
        // 96 + the scroller's 44 clears 124 with 16px to spare. The env() is
        // not decoration: the chrome's own padding is
        // `calc(env(safe-area-inset-bottom, 0px) + 16px)`, so it grows by the
        // gesture inset on hardware that has one. It measures 0 on the
        // emulator, which is exactly why a flat number looks correct there and
        // would still tuck the links under the bar on a real phone.
        padding: `0 ${gutter}px ${
          compact ? "calc(env(safe-area-inset-bottom, 0px) + 96px)" : "96px"
        }`,
      }}
    >
      {/* The end marker itself, which is what was missing entirely. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          margin: "8px 0 22px",
          color: theme.muted,
          fontFamily: FONT_STACKS.sans,
          fontSize: 10.5,
          letterSpacing: arabic ? "normal" : "0.1em",
        }}
      >
        <span style={{ flex: 1, height: 1, background: theme.rule }} />
        <span>
          {nextTitle === null
            ? tr("reader.endOfBook")
            : tr("reader.endOfChapter")}
        </span>
        <span style={{ flex: 1, height: 1, background: theme.rule }} />
      </div>

      {nextTitle === null ? null : (
        <button
          onClick={onNext}
          {...press}
          aria-label={`${tr("reader.nextChapter")}: ${nextTitle}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            width: "100%",
            minHeight: compact ? 84 : 76,
            padding: compact ? "17px 18px" : "17px 22px",
            borderRadius: 14,
            cursor: "pointer",
            font: "inherit",
            textAlign: "start",
            // NO fill. The card this replaced carried a chrome fill, a border
            // AND a 14px radius — three separate "this is a card" signals on a
            // page that is otherwise paper and type. The border alone says
            // control; the rest was just weight at the end of a chapter.
            background: pressed ? theme.hover : "transparent",
            // NOT `theme.ruleStrong`. Measured against the reading page that
            // token lands at 1.16–1.72:1 across the four themes — on OLED it
            // is invisible, and an invisible border cannot be the thing that
            // says "clickable" when it is the ONLY thing saying it. 0.35
            // measures 1.95–2.30:1. Same call, same reason, as
            // ChapterStartLink's capsule.
            border: `1px solid ${inkAlpha(theme, pressed ? 0.55 : 0.35)}`,
            color: theme.ink,
            transition:
              "background 120ms ease-out, border-color 120ms ease-out",
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontSize: 10,
                // Latin-only tracking and casing: Arabic is cursive, so
                // letter-spacing prises the joins apart, and it has no case to
                // upper. Same split the chapter opener makes.
                letterSpacing: arabic ? "normal" : "0.12em",
                textTransform: arabic ? "none" : "uppercase",
                fontWeight: 600,
                color: theme.muted,
                fontFamily: FONT_STACKS.sans,
                marginBottom: 6,
              }}
            >
              {tr("reader.nextChapter")}
            </span>
            <span
              style={{
                display: "block",
                // The SAME face a chapter opens in, not the body face. This
                // control names a chapter, and the name a reader sees here is
                // the name they will see at the top of the next screen — the
                // two should be set alike.
                //
                // 23px and not 18: Markazi's ink is ~76% of the reading sans'
                // at the same px, so this lands at ~17.5px apparent, which is
                // where the old body-face title sat. Do not "tidy" it down.
                fontFamily: FONT_CHAPTER_DISPLAY,
                fontSize: compact ? 23 : 24,
                lineHeight: 1.25,
              }}
            >
              {nextTitle}
            </span>
            {/* Context. Whether the next chapter is on the device predicts
                whether the turn will wait, which matters on a book this long.
                It wraps; it is never truncated — an ellipsis through
                "Chapter 3 of 2372" renders as "3 of 72", a plausible WRONG
                number, which is worse than two lines. */}
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                flexWrap: "wrap",
                marginTop: 7,
                fontFamily: FONT_STACKS.sans,
                fontSize: 11,
                color: theme.muted,
              }}
            >
              {availability ? (
                <>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Icon
                      name={
                        availability === "device" ? "check" : "downloadCirc"
                      }
                      size={13}
                    />
                    {availability === "device"
                      ? tr("reader.savedOnDevice")
                      : tr("reader.needsConnection")}
                  </span>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              <span>
                {/* formatNum on BOTH numerals. Interpolated raw — which is
                    what shipped — this line reads "الفصل 3 من 2372", Latin
                    digits inside an Arabic sentence. ChapterStartLink already
                    documents the same trap; the end card never got the fix. */}
                {tr("reader.chapterOfTotal", {
                  n: formatNum(nextNumber, locale),
                  total: formatNum(total, locale),
                })}
              </span>
            </span>
          </span>
          <span
            style={{
              color: theme.muted,
              display: "inline-flex",
              flexShrink: 0,
            }}
          >
            <Forward size={20} />
          </span>
        </button>
      )}

      {/* Marginalia. Outside the card on purpose: these are the two moves a
          reader makes INSTEAD of turning the page, and nothing here should
          compete with the turn. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          marginTop: nextTitle === null ? 0 : 6,
          color: theme.muted,
        }}
      >
        <MarginalLink
          theme={theme}
          label={tr("reader.toc")}
          onClick={onOpenToc}
        />
        <span aria-hidden="true" style={{ fontSize: 11.5 }}>
          ·
        </span>
        <MarginalLink
          theme={theme}
          label={tr("reader.topOfChapter")}
          onClick={onTopOfChapter}
        />
      </div>
    </div>
  );
}

interface StartProps {
  theme: Theme;
  tr: Tr;
  /** Phone: a taller hit area, since 26px is fine for a cursor and not for a
   *  thumb. Everything else is identical. */
  compact?: boolean;
  /** 1-based number of the previous chapter. */
  prevNumber: number;
  prevTitle: string;
  onPrev: () => void;
}

/**
 * The way back, above the chapter's heading.
 *
 * Backward navigation had no affordance at all — only a hidden gesture, the
 * scrubber or the table of contents — so a visible way forward would have left
 * a hidden way back.
 *
 * It NAMES the chapter it leads to. The first version was a bare "previous
 * chapter" label, which told the reader nothing about where they would land
 * while the card at the other end of the page showed a title; on a book of
 * 2372 chapters that is the difference between navigating and guessing.
 *
 * Kept deliberately lighter than the end-of-chapter card: no fill, a single
 * hairline beneath it, and a smaller title. It sits directly above the chapter
 * heading and must not compete with it — going back is the secondary move.
 *
 * It lands at the START of the chapter it names, not at its end. The control
 * names a chapter, so it has to deliver that chapter from the top — opening
 * it three screens in, wherever the reader happened to leave off, answers a
 * question nobody asked. The readers implement that by overriding resume for
 * this one move; see prevChapterAtStart.
 */
export function ChapterStartLink({
  theme,
  tr,
  compact = false,
  prevNumber,
  prevTitle,
  onPrev,
}: StartProps) {
  const [pressed, press] = usePressed();
  // The number is a numeral on the reading surface, so it follows the UI
  // language's digits the way the chapter opener's does. It used to be
  // interpolated raw, which put Latin "239" inside an Arabic line.
  const { locale } = useI18n();
  const arabic = locale === "ar";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        marginBottom: compact ? 12 : 14,
      }}
    >
      <button
        onClick={onPrev}
        {...press}
        // The visible text is a number and a title; the accessible name has to
        // say what the control DOES.
        aria-label={`${tr("reader.prevChapter")}: ${prevTitle}`}
        title={`${tr("reader.prevChapter")}: ${prevTitle}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          maxWidth: "min(100%, 520px)",
          // A capsule outline and no fill. The outline is the whole point: at
          // this size a bare line of tracked type reads as a caption, and a
          // caption does not look clickable. A border says "control" for one
          // hairline's worth of ink — where the 56px filled-ish card this
          // replaced said it with 59px of vertical space.
          //
          // Phone gets the vertical padding instead of the compactness: 26px
          // is a fine target for a cursor and half of the 44pt minimum for a
          // thumb.
          // 13px of vertical padding is what takes the phone's target to a
          // measured 44px — the platform minimum — around the same 18px of
          // content the desktop capsule wraps in 3px. Measured, not guessed:
          // the first pass used 9px and came out at 36px.
          padding: compact ? "13px 16px" : "3px 11px",
          borderRadius: 999,
          // NOT `theme.rule` or `ruleStrong`. Measured against the reading
          // page those two land at 1.16-1.72:1 — on the OLED theme a `rule`
          // border is 1.16:1, which is to say invisible, and an invisible
          // border cannot be the thing that says "clickable". 0.35 measures
          // 1.95-2.30:1 across the four themes: unmistakably an outline,
          // still a hairline rather than a chip.
          //
          // Short of the 3:1 that WCAG 1.4.11 asks of a boundary which is the
          // ONLY way to identify a control — it is not one here, since the
          // chevron and the label identify it too, and 3:1 needs an alpha
          // that reads as a solid button on a page of paper and type.
          border: `1px solid ${inkAlpha(theme, pressed ? 0.55 : 0.35)}`,
          background: pressed ? theme.hover : "transparent",
          color: theme.muted,
          cursor: "pointer",
          font: "inherit",
          transition: "background 120ms ease-out, border-color 120ms ease-out",
        }}
      >
        {/* A DOUBLE chevron pointing UP, not a mirrored horizontal one.
            Direction-neutral, so it needs neither the RTL flip nor the second
            flip that turned "forward" into "backward" — two chances to point
            the arrow at the wrong chapter, both gone. It also matches the
            gesture: this link exists only where the reader scrolls, and there
            the previous chapter genuinely is up. Two chevrons rather than one
            because it lands at that chapter's START — it skips past everything
            between here and there, so it is a section jump, not a step. */}
        <span style={{ display: "inline-flex", flexShrink: 0, opacity: 0.9 }}>
          <Icon name="chevronsU" size={13} />
        </span>
        <span
          style={{
            fontFamily: FONT_READING_SANS,
            fontSize: arabic ? 12 : 10.5,
            fontWeight: 600,
            // Latin-only tracking and casing: Arabic is cursive, so
            // letter-spacing prises the joins apart, and it has no case to
            // upper. Same split the chapter opener and the focus running head
            // make.
            letterSpacing: arabic ? "normal" : "0.12em",
            textTransform: arabic ? "none" : "uppercase",
            lineHeight: 1.3,
            // The FULL title, never truncated — an ellipsis here would hide
            // the one piece of information the control carries. A very long
            // one wraps inside the capsule instead of being cut.
            minWidth: 0,
            textAlign: "center",
          }}
        >
          {`${formatNum(prevNumber, locale)} · ${prevTitle}`}
        </span>
      </button>
    </div>
  );
}
