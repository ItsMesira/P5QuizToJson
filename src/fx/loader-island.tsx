/* ============ LOADER ISLAND — React mount point ============
   The app is vanilla TS; this is the ONE React island in it. Everything React
   lives behind this module, which is reached only through a dynamic import() from
   src/fx/loader.ts, so React, react-dom, framer-motion and Tailwind's stylesheet
   all land in a lazy chunk instead of the eager bundle.

   The mount API is deliberately imperative and minimal — the island owns no
   lifecycle of its own. src/fx/loader.ts keeps that, because the router's
   supersede/abort rules depend on it. */

import "../styles/tailwind.css";
import { createRoot, type Root } from "react-dom/client";
import BrutalistDeckLoader, { type DeckState } from "../components/ui/brutalist-deck-loader";

let root: Root | null = null;

/** Render (or re-render) the deck into `host`. Safe to call repeatedly; React
 *  reconciles, and AnimatePresence animates between states. */
export function renderDeck(host: HTMLElement, state: DeckState): void {
  if (!root) root = createRoot(host);
  root.render(<BrutalistDeckLoader {...state} />);
}

/** Tear the island down. Call this BEFORE removing `host` from the DOM so React
 *  does not warn about unmounting from a detached container. */
export function disposeDeck(): void {
  root?.unmount();
  root = null;
}
