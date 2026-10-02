// Strict checks for release-notes/<version>.json. Shared by the CLI (pnpm
// check, the release workflow) and the tests. The app has its own lenient
// parser (src/store/releaseNotes.ts): a release must be perfect, a running
// app must never crash on a slightly-off file.

export const IMAGE_CAP = 150 * 1024;
const KINDS = ["new", "improved", "fixed"];
const ARABIC = /[؀-ۿ]/;
export const IMAGE_NAME = /^[A-Za-z0-9_.-]+\.webp$/;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function onlyKeys(o, allowed, at, errs) {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) errs.push(`${at}: unknown key "${k}"`);
  }
}

function localized(o, at, errs) {
  if (!isObj(o)) {
    errs.push(`${at}: must be { en, ar }`);
    return;
  }
  onlyKeys(o, ["en", "ar"], at, errs);
  text(o.en, `${at}.en`, errs);
  text(o.ar, `${at}.ar`, errs, true);
}

function text(v, at, errs, arabic = false) {
  if (typeof v !== "string" || v.trim() === "") {
    errs.push(`${at}: missing`);
  } else if (arabic && !ARABIC.test(v)) {
    errs.push(`${at}: has no Arabic letters — was English pasted in?`);
  }
}

function image(name, at, errs, imageBytes) {
  if (name === undefined) return;
  if (typeof name !== "string" || !IMAGE_NAME.test(name)) {
    return errs.push(`${at}: must be a .webp file name`);
  }
  const size = imageBytes(name);
  if (size === undefined)
    errs.push(`${at}: ${name} is missing from release-notes/img/`);
  else if (size > IMAGE_CAP)
    errs.push(`${at}: ${name} is ${size} bytes; the cap is 150 KB`);
}

function card(c, at, errs, imageBytes, withKind) {
  if (!isObj(c)) {
    errs.push(`${at}: must be an object`);
    return;
  }
  onlyKeys(
    c,
    withKind ? ["kind", "image", "title", "body"] : ["image", "title", "body"],
    at,
    errs,
  );
  if (withKind && c.kind !== undefined && !KINDS.includes(c.kind)) {
    errs.push(`${at}.kind: must be one of ${KINDS.join(", ")}`);
  }
  image(c.image, `${at}.image`, errs, imageBytes);
  localized(c.title, `${at}.title`, errs);
  localized(c.body, `${at}.body`, errs);
}

/** @returns {string[]} every problem found; empty means valid. */
export function validateReleaseNotes(notes, { version, imageBytes }) {
  const errs = [];
  if (!isObj(notes)) return ["the file must hold one JSON object"];
  onlyKeys(
    notes,
    ["version", "date", "highlight", "stories", "items"],
    "notes",
    errs,
  );
  if (notes.version !== version) {
    errs.push(`version: "${notes.version}" but the file is for ${version}`);
  }
  if (
    typeof notes.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(notes.date)
  ) {
    errs.push("date: must be YYYY-MM-DD");
  }
  if (notes.highlight !== undefined) {
    card(notes.highlight, "highlight", errs, imageBytes, false);
  }
  if (notes.stories !== undefined) {
    if (!Array.isArray(notes.stories) || notes.stories.length === 0) {
      errs.push("stories: omit it, or give at least one page");
    } else {
      for (const [i, s] of notes.stories.entries()) {
        card(s, `stories[${i}]`, errs, imageBytes, true);
      }
    }
  }
  if (!Array.isArray(notes.items) || notes.items.length === 0) {
    errs.push("items: at least one change is required");
  } else {
    for (const [i, it] of notes.items.entries()) {
      const at = `items[${i}]`;
      if (!isObj(it)) {
        errs.push(`${at}: must be an object`);
        continue;
      }
      onlyKeys(it, ["kind", "en", "ar"], at, errs);
      if (!KINDS.includes(it.kind))
        errs.push(`${at}.kind: must be one of ${KINDS.join(", ")}`);
      text(it.en, `${at}.en`, errs);
      text(it.ar, `${at}.ar`, errs, true);
    }
  }
  return errs;
}
