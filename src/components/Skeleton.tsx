// Skeleton placeholders for loading states.
//
// One low-level primitive (`Skeleton`) + a few section-shaped composites
// (cover card, section row, novel header) so callers don't have to
// hand-tune dimensions. The shimmer animation lives in global.css under
// `.riwaq-skeleton`; this file just stamps elements with the right
// dimensions and the shared class.

import { Fragment, type CSSProperties } from "react";
import type { Theme } from "../styles/tokens";

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
  /** Override the per-theme color pair. Useful when the skeleton sits on
   *  a non-default background (e.g., inside a card with theme.chrome). */
  baseColor?: string;
  shineColor?: string;
}

export function Skeleton({
  width,
  height,
  radius = 6,
  style,
  baseColor,
  shineColor,
}: SkeletonProps) {
  return (
    <div
      className="riwaq-skeleton"
      style={{
        width,
        height,
        borderRadius: radius,
        flexShrink: 0,
        ...(baseColor
          ? ({
              ["--skel-base" as string]: baseColor,
              ["--skel-shine" as string]: shineColor ?? baseColor,
            } as CSSProperties)
          : {}),
        ...style,
      }}
    />
  );
}

/** Themed skeleton — adapts to the active theme so dark/sepia/oled all
 *  have visible shimmer instead of using the hardcoded default that
 *  leans light. Pass `theme` once and forward the rest. */
export function ThemedSkeleton({
  theme,
  ...rest
}: SkeletonProps & { theme: Theme }) {
  // Lighter themes need a slightly darker base to be visible; dark
  // themes need a slightly lighter base. The theme exposes both `bg`
  // (the surface) and `rule` (subtle hairlines) so we lean on `rule`
  // as the base shade and the hover color as the shine — both already
  // tuned to the surrounding palette.
  return (
    <Skeleton
      {...rest}
      baseColor={theme.rule}
      shineColor={theme.hover}
    />
  );
}

// ── composites ──────────────────────────────────────────────────────────────

/** Cover-card skeleton — matches NovelCard dimensions exactly (fixed
 *  140px wide, 2:3 cover + two title lines) so the layout doesn't
 *  reflow when real cards swap in. The outer width is set explicitly
 *  rather than via the parent flex item, since some flex containers
 *  end up stretching children that don't declare their own size. */
export function NovelCardSkeleton({ theme }: { theme: Theme }) {
  return (
    <div style={{ width: 140 }}>
      <div
        style={{
          aspectRatio: "2 / 3",
          width: 140,
          marginBottom: 10,
        }}
      >
        <ThemedSkeleton theme={theme} width={140} height="100%" radius={10} />
      </div>
      <ThemedSkeleton theme={theme} width={118} height={11} radius={3} />
      <div style={{ height: 5 }} />
      <ThemedSkeleton theme={theme} width={70} height={9} radius={3} />
    </div>
  );
}

/** Section-row skeleton — header line + a horizontal row of card
 *  skeletons. count defaults high enough that the row visibly
 *  overflows the viewport on any reasonable desktop width (so the user
 *  sees "this is a scrollable row of cards", not "this row ends with
 *  empty space"). The overflow is hidden because the skeleton itself
 *  isn't interactive — it's a static placeholder. */
export function SectionRowSkeleton({
  theme,
  count = 14,
}: {
  theme: Theme;
  count?: number;
}) {
  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <ThemedSkeleton theme={theme} width={160} height={16} radius={4} />
      </div>
      <div
        style={{
          display: "flex",
          gap: 14,
          overflow: "hidden",
          paddingInline: 4,
          paddingBottom: 8,
        }}
      >
        {Array.from({ length: count }).map((_, i) => (
          // `flex: 0 0 140px` triple-locks the width so no flex
          // container can stretch / shrink it. Each child renders
          // exactly as wide as a real card.
          <div key={i} style={{ flex: "0 0 140px" }}>
            <NovelCardSkeleton theme={theme} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Sections-list skeleton — three rows is the sweet spot: enough to
 *  convey "there's a lot of content coming" without flooding the
 *  viewport with shimmer. Real sections almost always exceed three
 *  rows; the rest fade in as the network resolves. */
export function SectionsListSkeleton({ theme }: { theme: Theme }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28, marginTop: 18 }}>
      {Array.from({ length: 3 }).map((_, i) => (
        <SectionRowSkeleton key={i} theme={theme} count={14} />
      ))}
    </div>
  );
}

/** Novel header skeleton — cover + title + meta + tags placeholders. */
export function NovelHeaderSkeleton({
  theme,
  layout,
}: {
  theme: Theme;
  layout: "desktop" | "mobile";
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: layout === "mobile" ? 14 : 28,
        padding: layout === "mobile" ? "20px 18px" : "32px 40px 24px",
        flexDirection: layout === "mobile" ? "column" : "row",
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          width: layout === "mobile" ? 140 : 200,
          flexShrink: 0,
          alignSelf: layout === "mobile" ? "center" : "flex-start",
        }}
      >
        <div style={{ width: "100%", aspectRatio: "2 / 3" }}>
          <ThemedSkeleton theme={theme} width="100%" height="100%" radius={12} />
        </div>
      </div>
      <div style={{ flex: 1, width: "100%" }}>
        <ThemedSkeleton theme={theme} width="70%" height={28} radius={5} />
        <div style={{ height: 8 }} />
        <ThemedSkeleton theme={theme} width="40%" height={14} radius={4} />
        <div style={{ height: 18 }} />
        <div style={{ display: "grid", gap: 6, gridTemplateColumns: "auto 1fr", maxWidth: 360 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Fragment key={i}>
              <ThemedSkeleton theme={theme} width={80} height={11} radius={3} />
              <ThemedSkeleton theme={theme} width="80%" height={11} radius={3} />
            </Fragment>
          ))}
        </div>
        <div style={{ height: 18 }} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <ThemedSkeleton
              key={i}
              theme={theme}
              width={50 + ((i * 13) % 30)}
              height={20}
              radius={999}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Accordion-of-volumes skeleton — a few collapsed-looking volume
 *  rows so the user knows chapters are coming. */
export function VolumesSkeleton({
  theme,
  layout,
}: {
  theme: Theme;
  layout: "desktop" | "mobile";
}) {
  return (
    <div
      style={{
        padding: layout === "mobile" ? "0 18px 40px" : "0 40px 40px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <ThemedSkeleton theme={theme} width={120} height={16} radius={4} />
      {Array.from({ length: 3 }).map((_, i) => (
        <ThemedSkeleton key={i} theme={theme} width="100%" height={46} radius={10} />
      ))}
    </div>
  );
}
