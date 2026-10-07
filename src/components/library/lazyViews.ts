import { type ComponentProps, createElement, lazy, useState } from "react";

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

// The Store's code, loaded once and shared by the boundary and preloadStore.
type StoreComponent = typeof import("../Store").Store;
let storeModule: Promise<{ default: StoreComponent }> | null = null;
/** The component itself, once its code has arrived. */
let storeImpl: StoreComponent | null = null;
function loadStore() {
  storeModule ??= import("../Store").then((m) => {
    storeImpl = m.Store;
    return { default: m.Store };
  });
  return storeModule;
}

const LazyStore = lazy(loadStore);

/** The Store, through a Suspense boundary only until its code has loaded.
 *  After a preload it renders the real component directly — no suspension,
 *  so no fallback frame, which on the phone's Store tab read as the page
 *  "appearing blank first". Decided once per mount: switching component
 *  type mid-life would remount the Store and drop its state. */
export function Store(props: ComponentProps<StoreComponent>) {
  const [Impl] = useState<StoreComponent | null>(() => storeImpl);
  return Impl ? createElement(Impl, props) : createElement(LazyStore, props);
}

/** Fetch and parse the Store's code ahead of the first tap on its tab. Code
 *  only: it does not start loading extensions, which must never happen at
 *  startup (see Store.tsx). Called once the phone's home shell is idle. */
export function preloadStore(): void {
  void loadStore();
}

export const NovelDetailView = lazy(() =>
  import("../novel/NovelDetailView").then((m) => ({
    default: m.NovelDetailView,
  })),
);
