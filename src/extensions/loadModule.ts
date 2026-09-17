// Evaluates an extension bundle's source text into a live module.
//
// Blob URL + dynamic import(), rather than eval or new Function, for two
// reasons: the bundles are real ESM (they have `export default`), and this
// keeps them off the app's own module graph so a broken extension cannot
// corrupt anything already loaded.
//
// The object URL is revoked in a finally block. Revoking is safe the moment
// import() has resolved — the module has been fetched and compiled by then,
// and nothing re-reads the URL afterwards.

/** Evaluate ESM `source` and resolve to its module namespace object.
 *  Each call produces a fresh module instance (a distinct blob URL is a
 *  distinct module specifier), so two extensions never share module state. */
export async function loadModuleFromSource(source: string): Promise<unknown> {
  const blob = new Blob([source], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
