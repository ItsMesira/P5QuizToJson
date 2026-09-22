// This is a file with a demo for your component
// That's what users will see in the preview
// Create new files in this directory to add more demos

import BrutalistDeckLoader, { type DeckPhase } from "@/components/ui/brutalist-deck-loader";

const PHASES: DeckPhase[] = [
  { id: "briefcase", tag: "PHASE 01", title: "Opening the Briefcase" },
  { id: "card", tag: "PHASE 02", title: "Forging the Calling Card" },
  { id: "palace", tag: "PHASE 03", title: "Infiltrating the Palace" },
  { id: "heart", tag: "PHASE 04", title: "Taking Your Heart" },
];

// ONLY DEFAULT EXPORT WILL BE TREATED AS A DEMO
export default function DemoOne() {
  return (
    <BrutalistDeckLoader
      phases={PHASES}
      activeIndex={1}
      progress={42}
      status="Processing assets…"
    />
  );
}
