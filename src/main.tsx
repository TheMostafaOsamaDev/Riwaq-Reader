import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import { migrateLegacyRoot } from "./store/legacyRoot";

// The app-data root is migrated BEFORE the tree mounts, not lazily from inside
// the store modules.
//
// Every store function runs from a React effect or an event handler, so nothing
// can touch app-data before render() — which makes this the one place that is
// genuinely ordered ahead of all of them. Doing it per-call-site instead is not
// safe: a read that runs before the move sees an empty root and can persist
// that emptiness on top of the data the move then puts in place. That is a real
// bug this had — `listShelves()` probed `exists(shelves.json)`, seeded the two
// default shelves because the file "didn't exist" yet, and its write (which did
// trigger the migration) then overwrote the freshly-migrated real shelves.
//
// `migrateLegacyRoot()` is memoized and never rejects, so the store-side calls
// are kept as cheap defence-in-depth rather than removed.
void migrateLegacyRoot().finally(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
