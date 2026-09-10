import { lazy } from "react";

// Kept off the startup path — neither is needed to paint the library, and a
// user who only reads their own files never loads either. Together with
// SourceStreamReader (lazied in App.tsx) this is the whole Store subsystem.
//
// NovelDetailView gets its own boundary rather than riding along inside Store,
// because the library reaches it directly for source-backed entries — not only
// through the Store tab. Store keeps its own static import of it, so Rollup
// shares one chunk between the two entry points.
//
// They live in this shared file rather than in either layout because
// DesktopLibrary and MobileLibrary both render them, and two `lazy()` calls
// over the same module would be two boundaries around one chunk. A static
// import of either from anywhere on the startup path undoes all of this:
// `src/bundleSplit.test.ts` fails if one creeps back in.

export const Store = lazy(() =>
  import("../Store").then((m) => ({ default: m.Store })),
);

export const NovelDetailView = lazy(() =>
  import("../novel/NovelDetailView").then((m) => ({
    default: m.NovelDetailView,
  })),
);
