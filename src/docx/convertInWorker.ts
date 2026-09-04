// Try the worker; fall back to converting in-thread.
//
// mammoth ships a browser bundle and a worker has no `document` — if it turns
// out to need one on some platform, a failed import is a far worse outcome
// than a janky one, so every failure path lands on docxToRawHtml.

import { docxToRawHtml, type RawDocx } from "./rawHtml";

interface WorkerReply {
  ok: boolean;
  raw?: RawDocx;
  message?: string;
}

export async function docxToRawHtmlInWorker(
  bytes: Uint8Array,
): Promise<RawDocx> {
  if (typeof Worker !== "function") return docxToRawHtml(bytes);
  try {
    return await runWorker(bytes);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[docx] worker conversion failed, converting in-thread:", e);
    return docxToRawHtml(bytes);
  }
}

function runWorker(bytes: Uint8Array): Promise<RawDocx> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./docxWorker.ts", import.meta.url), {
      type: "module",
    });
    const settle = (fn: () => void) => {
      worker.terminate();
      fn();
    };
    worker.onerror = (e) =>
      settle(() => reject(new Error(e.message || "worker error")));
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const reply = e.data;
      if (reply.ok && reply.raw) {
        const raw = reply.raw;
        settle(() => resolve(raw));
      } else {
        settle(() => reject(new Error(reply.message ?? "worker failed")));
      }
    };
    // Copy the input rather than transferring it: the caller
    // (fixedImportStage) still holds this buffer for the commit path.
    worker.postMessage({ bytes: bytes.slice().buffer });
  });
}
