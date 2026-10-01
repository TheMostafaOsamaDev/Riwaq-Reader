/** True when a key event is aimed at somewhere the user types: an input, a
 *  textarea, or editable content. Arrow keys there belong to the field. */
export function isTextEntry(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return (
    t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable
  );
}
