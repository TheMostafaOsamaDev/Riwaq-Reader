// The "open the Extensions manager" request has two answerers and they are
// not symmetric: the Library only switches destination, and the Store —
// which usually does not exist yet when the request is made from a
// library-backed novel page — is the one that consumes it, on its own
// mount. So the flag has to OUTLIVE the emit, and it has to be taken
// exactly once. Both are easy to break by "tidying" the pending value into
// the subscription.
import { describe, expect, it } from "vitest";
import {
  onOpenExtensionsManager,
  openExtensionsManager,
  takePendingExtensionsManager,
} from "./uiIntents";

describe("openExtensionsManager", () => {
  it("has nothing pending before anyone asks", () => {
    expect(takePendingExtensionsManager()).toBe(false);
  });

  it("notifies a live subscriber", () => {
    let calls = 0;
    const off = onOpenExtensionsManager(() => {
      calls++;
    });
    openExtensionsManager();
    off();
    takePendingExtensionsManager();
    expect(calls).toBe(1);
  });

  it("leaves the request pending for a subscriber that does not consume it", () => {
    // Exactly the Library's listener: it switches destination and takes
    // nothing, so the Store still finds the request when it mounts.
    const off = onOpenExtensionsManager(() => {});
    openExtensionsManager();
    off();
    expect(takePendingExtensionsManager()).toBe(true);
  });

  it("survives an emit with no subscriber at all", () => {
    openExtensionsManager();
    expect(takePendingExtensionsManager()).toBe(true);
  });

  it("is consumed exactly once", () => {
    openExtensionsManager();
    expect(takePendingExtensionsManager()).toBe(true);
    expect(takePendingExtensionsManager()).toBe(false);
  });

  it("stops notifying an unsubscribed listener", () => {
    let calls = 0;
    const off = onOpenExtensionsManager(() => {
      calls++;
    });
    off();
    openExtensionsManager();
    takePendingExtensionsManager();
    expect(calls).toBe(0);
  });
});
