/// <reference lib="webworker" />
// Runs the unzip + mammoth pass off the main thread. Image buffers are
// transferred rather than copied, so a picture-heavy document doesn't pay for
// a second copy on the way back.

import { docxToRawHtml } from "./rawHtml";

self.onmessage = async (e: MessageEvent<{ bytes: ArrayBuffer }>) => {
  const post = self as unknown as Worker;
  try {
    const raw = await docxToRawHtml(new Uint8Array(e.data.bytes));
    const transfer = raw.images.map((i) => i.bytes.buffer as ArrayBuffer);
    post.postMessage({ ok: true, raw }, transfer);
  } catch (err) {
    post.postMessage({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
