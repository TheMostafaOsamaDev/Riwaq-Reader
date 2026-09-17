// Evaluates an extension bundle's source text into a live module.
//
// Blob URL + dynamic import(), rather than eval or new Function, for two
// reasons: the bundles are real ESM (they have `export default`), and this
// keeps them off the app's own module graph so a broken extension cannot
// corrupt anything already loaded.
//
// The object URL is revoked in a finally block — on the success path and on
// the throw path alike, so a broken extension bundle can't leak a blob URL.
//
// `importModule` exists only as a test seam. Node's own ESM loader refuses
// `blob:` specifiers outright, so the blob-create/revoke lifecycle can only
// be exercised under Vitest (which runs on Node) by substituting a fake
// importer; see loadModule.test.ts for exactly what that does and doesn't
// cover. The default is exactly what ships: a real dynamic import().

/** A function that resolves a specifier to a module namespace object — the
 *  shape of dynamic `import()`. The second parameter exists so tests can
 *  substitute a fake one; production code should never pass it. */
export type ModuleImporter = (url: string) => Promise<unknown>;

const realImport: ModuleImporter = (url) => import(/* @vite-ignore */ url);

/** Evaluate ESM `source` and resolve to its module namespace object.
 *  Each call produces a fresh module instance (a distinct blob URL is a
 *  distinct module specifier), so two extensions never share module state. */
export async function loadModuleFromSource(
  source: string,
  importModule: ModuleImporter = realImport,
): Promise<unknown> {
  const blob = new Blob([source], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    return await importModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
