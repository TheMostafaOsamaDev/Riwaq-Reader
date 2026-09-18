// The wire shape of `source_fetch`, in one place.
//
// This is the JSON `src-tauri/src/sources.rs`'s `FetchResponse` serialises
// to, and the two callers that had each declared their own copy of it —
// sources/host.ts (extensions' fetch) and extensions/repos.ts (fetching a
// repository index) — now import it, so the struct and its mirror cannot
// drift apart in one file while staying right in the other.
//
// Kept out of sources/types.ts on purpose: that file is the EXTENSION
// contract, which deliberately says nothing about Tauri. This is the
// app-side transport underneath it.

export interface TauriFetchResponse {
  status: number;
  text: string;
  headers: Record<string, string>;
}
