// Shared reader top chrome: back/home button · divider · nav cluster ·
// centered title + subtitle · trailing cluster, with a 2px progress fill pinned
// to the bottom edge. Used by both the reflow DesktopReader and the fixed-page
// FixedPageReader so the two readers share one top-bar implementation.
//
// The nav/trailing button clusters are passed as slots (each reader builds them
// with ReaderIconButton) — only the layout, title block, and progress fill live
// here.

import type { CSSProperties, ReactNode, RefObject } from "react";
import { FONT_STACKS, type Theme } from "../../styles/tokens";
import { fractionToWidth } from "../../components/readerProgress";
import { ReaderIconButton } from "./ReaderIconButton";
import type { IconProps } from "../../components/Icon";

interface Props {
  theme: Theme;
  onBack: () => void;
  backLabel: string;
  /** Leading icon — "home" for both readers by default. */
  backIcon?: IconProps["name"];
  title: string;
  subtitle?: string;
  /** Extra title styling (font family / italic) — the reflow reader varies the
   *  title font per chapter language; the fixed reader keeps the sans stack. */
  titleStyle?: CSSProperties;
  /** Nav cluster after the back button + divider (e.g. TOC, bookmarks). */
  navButtons?: ReactNode;
  /** Trailing cluster (e.g. progress, settings). */
  trailing?: ReactNode;
  /** Imperatively-updated fill (reflow reader writes width on scroll frames). */
  progressFillRef?: RefObject<HTMLDivElement | null>;
  /** Static fill fraction (fixed-page reader updates via state). 0..1. */
  progressFraction?: number;
  /** Fill grows from the reading-start edge: right in RTL, left in LTR. */
  fillRtl?: boolean;
}

export function ReaderTopBar({
  theme,
  onBack,
  backLabel,
  backIcon = "home",
  title,
  subtitle,
  titleStyle,
  navButtons,
  trailing,
  progressFillRef,
  progressFraction,
  fillRtl = false,
}: Props) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "14px 22px",
        borderBottom: `0.5px solid ${theme.rule}`,
        background: theme.bg,
        color: theme.chromeInk,
        fontFamily: FONT_STACKS.sans,
        flexShrink: 0,
      }}
    >
      <ReaderIconButton theme={theme} icon={backIcon} label={backLabel} onClick={onBack} />
      <div style={{ width: 1, height: 18, background: theme.rule, margin: "0 4px" }} />
      {navButtons}

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          minWidth: 0,
        }}
      >
        <div
          title={title}
          style={{
            fontSize: 13,
            lineHeight: 1.55,
            fontWeight: 500,
            color: theme.ink,
            letterSpacing: "-0.01em",
            width: "100%",
            textAlign: "center",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            ...titleStyle,
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 10.5, color: theme.muted }}>{subtitle}</div>
        )}
      </div>

      {trailing}

      {/* 2px progress fill pinned to the bottom edge (indicative only). */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 2,
          background: theme.rule,
          pointerEvents: "none",
        }}
      >
        <div
          ref={progressFillRef}
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            ...(fillRtl ? { right: 0 } : { left: 0 }),
            width: fractionToWidth(progressFraction ?? 0),
            background: theme.ink,
          }}
        />
      </div>
    </div>
  );
}
