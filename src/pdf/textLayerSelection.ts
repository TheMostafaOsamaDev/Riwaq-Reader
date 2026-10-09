// Keeps a mouse selection over a pdf.js text layer where the pointer is.
//
// A text layer is a scatter of absolutely positioned, transparent spans with
// empty space between them. When a drag crosses that space, the browser has no
// text under the pointer and resolves the selection's moving end by its own
// rules — usually to some earlier node in the layer — so dragging across a
// heading to the end of a word could suddenly select the chapter title above
// it instead. pdf.js's own viewer avoids this with an `endOfContent` element
// (TextLayerBuilder in pdfjs-dist/web/pdf_viewer.mjs), which this ports:
//
//   - while a selection is being made, the layer carries `.selecting`, and its
//     `endOfContent` grows to cover the whole layer (global.css) beneath the
//     spans, so empty space is still "in" the layer;
//   - on every selection change, `endOfContent` is moved to sit right after
//     the node the selection's moving end is in, so the space past the text
//     resolves to THAT point in document order, not to wherever the browser
//     guesses.
//
// One document-level listener serves every registered layer.

const layers = new Map<HTMLElement, HTMLElement>();
let abort: AbortController | null = null;

function reset(end: HTMLElement, layer: HTMLElement) {
  layer.append(end);
  end.style.width = "";
  end.style.height = "";
  layer.classList.remove("selecting");
}

function listen() {
  if (abort) return;
  abort = new AbortController();
  const { signal } = abort;
  let pointerDown = false;
  let prevRange: Range | null = null;
  document.addEventListener(
    "pointerdown",
    () => {
      pointerDown = true;
    },
    { signal },
  );
  document.addEventListener(
    "pointerup",
    () => {
      pointerDown = false;
      layers.forEach(reset);
    },
    { signal },
  );
  window.addEventListener(
    "blur",
    () => {
      pointerDown = false;
      layers.forEach(reset);
    },
    { signal },
  );
  document.addEventListener(
    "keyup",
    () => {
      if (!pointerDown) layers.forEach(reset);
    },
    { signal },
  );
  document.addEventListener(
    "selectionchange",
    () => {
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0) {
        layers.forEach(reset);
        return;
      }
      const range = selection.getRangeAt(0);
      for (const [layer, end] of layers) {
        if (range.intersectsNode(layer)) layer.classList.add("selecting");
        else reset(end, layer);
      }
      // Which end is moving: the start, if the end held still since last time.
      const modifyStart =
        prevRange !== null &&
        (range.compareBoundaryPoints(Range.END_TO_END, prevRange) === 0 ||
          range.compareBoundaryPoints(Range.START_TO_END, prevRange) === 0);
      let anchor: Node | null = modifyStart
        ? range.startContainer
        : range.endContainer;
      if (anchor?.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
      const parentLayer = (anchor as Element | null)?.parentElement?.closest(
        ".textLayer",
      ) as HTMLElement | null;
      const end = parentLayer ? layers.get(parentLayer) : undefined;
      if (end && anchor?.parentElement) {
        end.style.width = parentLayer!.style.width;
        end.style.height = parentLayer!.style.height;
        anchor.parentElement.insertBefore(
          end,
          modifyStart ? anchor : anchor.nextSibling,
        );
      }
      prevRange = range.cloneRange();
    },
    { signal },
  );
}

/** Give a freshly rendered text layer its `endOfContent`. Call after every
 *  render of the layer — a render empties it. */
export function attachTextLayerSelection(layer: HTMLElement): void {
  let end = layers.get(layer);
  if (!end) {
    end = document.createElement("div");
    end.className = "endOfContent";
    layer.addEventListener("mousedown", () => layer.classList.add("selecting"));
    layers.set(layer, end);
  }
  layer.append(end);
  listen();
}

/** Forget a layer whose page has been released. */
export function detachTextLayerSelection(layer: HTMLElement): void {
  layers.get(layer)?.remove();
  layers.delete(layer);
  layer.classList.remove("selecting");
  if (layers.size === 0) {
    abort?.abort();
    abort = null;
  }
}
