/* ============ P5 QUIZ — PORTRAIT ART REGISTRY (from P5ex) ============ */

export interface Portrait {
  src: string;
  name: string;
}

/* party members — the rotating cut-in roster */
export const PARTY: Portrait[] = [
  { src: "./art/jokerface2.png", name: "JOKER" },
  { src: "./art/P5_Joker_Chain_Chronicle_1.png", name: "JOKER II" },
  { src: "./art/char1.png", name: "SKULL" },
  { src: "./art/char2.png", name: "PANTHER" },
  { src: "./art/char3.png", name: "FOX" },
];

/* dialogue-box mascots (explanation/hint cards) */
export const DIALOGUE: Portrait[] = [
  { src: "./art/P5S_Protagonist_Dialogue2.png", name: "TACTICA" },
  { src: "./art/P5S_Protagonist_Dialogue3.png", name: "TACTICA II" },
];

let lastIdx = -1;

export function randomPortrait(): Portrait {
  let idx = Math.floor(Math.random() * PARTY.length);
  if (PARTY.length > 1 && idx === lastIdx) {
    idx = (idx + 1) % PARTY.length;
  }
  lastIdx = idx;
  return PARTY[idx];
}

export function randomDialogue(): Portrait {
  return DIALOGUE[Math.floor(Math.random() * DIALOGUE.length)];
}

export function portraitForName(name: string): Portrait {
  return PARTY.find((p) => p.name === name) ?? PARTY[0];
}

export const CARD_ART = "./art/card.png";
export const SIGN_ART = "./art/newsign.png";
