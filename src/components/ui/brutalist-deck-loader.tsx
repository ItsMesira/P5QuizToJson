/* ============ P5 CALLING-CARD LOADER ============
   Adapted from the supplied `brutalist-deck-loader`. The deck-of-cards motion is
   kept because it suits this product better than it suited the original: Persona 5
   is *about* calling cards, and the app already says "TAKING YOUR HEART" and
   "FORGING THE CALLING CARD".

   What changed, and why:

   - The brutalist palette (beige ground, yellow/blue/green/red cards, dotted paper)
     is replaced by this project's P5 tokens — ink ground, paper cards, hard offset
     shadows, red→gold accents. A loader that dresses in a foreign visual language
     reads as a bug in an app this stylised.

   - The original advanced five cards on a 1800ms `setInterval` with invented steps
     (COMPILING / OPTIMIZING / HYDRATING). That is a loader that can contradict the
     app — it finishes early and keeps "working", or stalls on a step that already
     passed. Cards here are supplied by the caller and advance on milestones the app
     actually reports. A loader that lies is the main way a loading screen reads as
     broken, which is the one thing this was asked not to be.

   - `"use client"` is dropped: it is a Next.js directive with no meaning under Vite,
     and Rollup warns about module-level directives when bundling.

   Accessibility: `role="status"` + `aria-live="polite"` announce the phase rather
   than the animation, and `prefers-reduced-motion` renders a static card instead of
   the deck — the information survives without the motion. */

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Loader2, Sparkles, RefreshCw } from "lucide-react";

export interface DeckPhase {
  /** Stable key — drives AnimatePresence identity. */
  id: string;
  /** Short mono label, e.g. "PHASE 02". */
  tag: string;
  /** The phase name in the app's own voice, e.g. "FORGING THE CALLING CARD". */
  title: string;
}

export interface DeckState {
  /** Real phases. The deck renders one card per phase. */
  phases: DeckPhase[];
  /** Which phase the app is genuinely on. Clamped by the component. */
  activeIndex: number;
  /** 0-100, or null when genuinely indeterminate. Never faked. */
  progress: number | null;
  /** Persistent status line under the deck. */
  status: string;
}

const MAX_VISIBLE = 4;

export default function BrutalistDeckLoader({ phases, activeIndex, progress, status }: DeckState) {
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(activeIndex, phases.length - 1));

  /* The deck only ever shows the current card and the ones behind it, so a long
     phase list cannot grow the stack past the viewport. */
  const visible = phases.slice(clamped, clamped + MAX_VISIBLE);
  const pct = progress === null ? null : Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div
      className="p5-loader-island fixed inset-0 z-50 flex items-center justify-center bg-p5-ink antialiased"
      /* The island carries its OWN ground rather than letting the veil show
         through. The loader mounts at 140ms, but the veil's ink field does not
         finish fading in until ~400ms — so a transparent island left the deck
         floating over the live screen mid-transition, which is exactly the
         broken look this is meant to avoid. The cost is that the veil's stripe
         sweep is behind the deck on the way in; it is still visible on the way
         out, when the island fades with the veil's own background.

         The stripe band here echoes the veil at low opacity so the surface still
         reads as part of the same wipe. */
      style={{
        backgroundImage:
          "radial-gradient(rgba(246,244,240,0.06) 1px, transparent 1px), \
           linear-gradient(104deg, transparent 0 78%, rgba(230,0,18,0.30) 78% 85%, transparent 85% 100%)",
        backgroundSize: "18px 18px, 100% 100%",
      }}
    >
      {/* The composition is designed at a fixed size. On a short viewport (a
          landscape phone) it is SCALED, not reflowed, so the calling card keeps
          its proportions instead of collapsing into a different shape. The scale
          lives in src/styles/tailwind.css beside the deck's other rules. */}
      <div
        className="p5-deck relative flex flex-col items-center"
        style={{ transform: "scale(var(--p5-deck-scale, 1))" }}
      >
        <div
          className="relative h-72 w-64"
          style={{ perspective: "1200px" }}
          aria-hidden="true"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {visible.map((phase, i) => {
              const isTop = i === 0;
              return (
                <motion.div
                  key={phase.id}
                  layout
                  initial={reduced ? { opacity: 0 } : { scale: 0.8, y: -100, rotateX: 45, opacity: 0 }}
                  animate={{
                    /* The offsets have to out-run the scale shrink, or the cards
                       behind vanish under the top one and the deck reads as a
                       drop shadow instead of a stack. */
                    x: isTop ? 0 : i * 14,
                    y: isTop ? 0 : i * 13,
                    /* slight alternating skew — the app's cards are never square-on */
                    rotate: isTop ? -1.5 : (i % 2 === 0 ? 1 : -1) * i * 2.2,
                    scale: 1 - i * 0.03,
                    zIndex: MAX_VISIBLE - i,
                    opacity: 1,
                  }}
                  exit={
                    reduced
                      ? { opacity: 0 }
                      : { x: 220, y: -40, rotate: 20, scale: 0.9, opacity: 0 }
                  }
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 260, damping: 24 }
                  }
                  data-loader-card=""
                  className="absolute inset-0 flex h-72 w-64 select-none flex-col justify-between border-[3px] border-black bg-p5-paper p-5"
                  style={{
                    transformStyle: "preserve-3d",
                    /* the shared P5 device — same hard cut as --shadow-cut */
                    boxShadow: "8px 8px 0 0 rgba(0,0,0,0.85)",
                  }}
                >
                  {/* HEADER — mask mark + phase chip */}
                  <div className="flex items-center justify-between">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-black bg-white">
                      <div className="h-2 w-2 rounded-full bg-p5-red" />
                    </div>
                    <span className="border-2 border-black bg-white px-2 py-0.5 font-p5-mono text-[10px] font-black tracking-widest text-p5-ink shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                      {phase.tag}
                    </span>
                  </div>

                  {/* BODY — icon + phase name */}
                  <div className="my-auto flex flex-col items-center justify-center gap-3">
                    {isTop ? (
                      <motion.div
                        animate={reduced ? undefined : { rotate: 360 }}
                        transition={
                          reduced
                            ? undefined
                            : { repeat: Infinity, duration: 3, ease: "linear" }
                        }
                        className="rounded-full border-2 border-black bg-p5-ink p-3.5 text-p5-paper"
                      >
                        <RefreshCw size={30} />
                      </motion.div>
                    ) : (
                      <div className="rounded-full border-2 border-black bg-white/60 p-3.5">
                        <Sparkles size={30} className="text-p5-ink" />
                      </div>
                    )}

                    <h3 className="text-center font-p5-display text-2xl leading-[0.92] tracking-tight text-p5-ink uppercase">
                      {phase.title}
                    </h3>
                  </div>

                  {/* FOOTER — real progress only */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between font-p5-mono text-[10px] font-bold tracking-widest text-p5-ink">
                      <span>STATUS</span>
                      <span>{pct === null ? "◆ ◆ ◆" : `${pct}%`}</span>
                    </div>
                    <div className="h-4 w-full border-2 border-black bg-white p-0.5 shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                      <motion.div
                        className="h-full"
                        style={{
                          background:
                            "linear-gradient(90deg, var(--color-p5-red-deep), var(--color-p5-red) 45%, var(--color-p5-gold-hot))",
                          transformOrigin: "left center",
                        }}
                        animate={
                          pct === null
                            ? reduced
                              ? { scaleX: 0.6 }
                              : { scaleX: [0.06, 0.86, 0.06] }
                            : { scaleX: pct / 100 }
                        }
                        transition={
                          pct === null && !reduced
                            ? { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
                            : { duration: 0.45, ease: [0.2, 0.9, 0.3, 1.15] }
                        }
                      />
                    </div>
                  </div>

                  {/* corner cut — the sticker clip the rest of the app uses */}
                  <div
                    className="pointer-events-none absolute top-0 right-0 h-9 w-9 bg-p5-red"
                    style={{ clipPath: "polygon(100% 0, 0 0, 100% 100%)" }}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* STATUS BAR */}
        <div
          role="status"
          aria-live="polite"
          className="z-10 mt-12 flex w-fit items-center justify-center gap-3 border-[3px] border-black bg-p5-ink px-5 py-2 font-p5-mono text-xs font-bold tracking-widest text-p5-paper uppercase shadow-[4px_4px_0_0_rgba(0,0,0,0.85)]"
        >
          <Loader2 className="shrink-0 animate-spin text-p5-gold" size={16} />
          <span>{status}</span>
        </div>
      </div>
    </div>
  );
}
