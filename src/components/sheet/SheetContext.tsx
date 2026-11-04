// What a MobileSheet offers the content inside it.
//
//  - `reveal(el)`: bring an element (a dropdown that just opened, say) fully
//    into view, expanding the sheet first when it can.
//  - `SheetFooter`: a primary action pinned to the visible bottom of the
//    sheet at every snap. Outside a sheet it renders in place, so content
//    shared with a desktop dialog keeps working there.

import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

export interface SheetApi {
  reveal(el: HTMLElement): void;
  /** The sheet's footer slot, once mounted. */
  footerSlot: HTMLElement | null;
}

export const SheetContext = createContext<SheetApi | null>(null);

/** The enclosing sheet, or null outside one. */
export function useSheet(): SheetApi | null {
  return useContext(SheetContext);
}

/** Pins its children to the visible bottom of the enclosing sheet. The
 *  sheet's engine keeps the slot on the screen bottom between the full and
 *  default snaps, so a primary button is reachable without expanding. */
export function SheetFooter({ children }: { children: ReactNode }) {
  const sheet = useSheet();
  if (!sheet) return <>{children}</>;
  if (!sheet.footerSlot) return null;
  return createPortal(children, sheet.footerSlot);
}
