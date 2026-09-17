/* ============ P5 QUIZ — MASTER PROMPT ENGINE + PRESETS ============ */
import type { QuestionType, QuizMode } from "./types";

export type Audience = "kids" | "teens" | "adults" | "experts";
export type DifficultyMix = "chill" | "balanced" | "brutal";
export type Tone = "fun" | "serious" | "dramatic";
export type Blooms = "recall" | "apply" | "analyze" | "mix";

export interface PromptFields {
  topic: string;
  audience: Audience;
  language: string;
  count: number;
  sections: number;
  difficulty: DifficultyMix;
  types: QuestionType[];
  mode: QuizMode;
  timeLimit: number | null;
  explanations: boolean;
  hints: boolean;
  negativeMarking: boolean;
  tone: Tone;
  title: string;
  notes: string;
  answerKey: boolean;
  exampleEmbed: boolean;
  blooms: Blooms;
  spaced: boolean;
  targetLang?: string;
  nativeLang?: string;
  /* interview mode: the AI asks for what it still needs, then builds the quiz */
  interview?: boolean;
}

export interface Preset {
  id: string;
  kind: "builtin" | "custom";
  title: string;
  tagline: string;
  tags: string[];
  fields: PromptFields;
}

export const DIFF_SPLIT: Record<DifficultyMix, [number, number, number]> = {
  chill: [50, 35, 15],
  balanced: [40, 40, 20],
  brutal: [20, 40, 40],
};

export function defaultFields(): PromptFields {
  return {
    topic: "",
    audience: "teens",
    language: "English",
    count: 10,
    sections: 1,
    difficulty: "balanced",
    types: ["multiple", "boolean", "fill"],
    mode: "standard",
    timeLimit: 20,
    explanations: true,
    hints: false,
    negativeMarking: false,
    tone: "fun",
    title: "",
    notes: "",
    answerKey: false,
    exampleEmbed: false,
    blooms: "mix",
    spaced: false,
  };
}

/* ---------------- shared blocks ---------------- */

const SCHEMA_REF = `THE JSON SCHEMA (follow exactly, no extra fields that aren't listed):
{
  "title": "string — quiz title",
  "description": "string — one short sentence (optional)",
  "accent": "#e60012 — any hex color for theming (optional)",
  "author": "string (optional)",
  "passScore": 70 — number 0-100, score % needed to pass (optional)",
  "settings": { — ALL optional, these are defaults
    "mode": "standard" | "practice" | "survival" | "rapid" | "endless",
    "timeLimit": 30 — seconds per question, or null to disable,
    "shuffle": true — shuffle question order,
    "shuffleAnswers": true — shuffle answer order,
    "negativeMarking": false — wrong answers lose half points,
    "feedback": "instant" | "end"
  },
  "sections": [
    { "name": "Section Name", "questions": [ QUESTION, QUESTION, ... ] },
    { "name": "Another Section", "questions": [ ... ] }
  ]
}

QUESTION object (pick ONE type):
- multiple / boolean:  { "type": "multiple", "question": "...", "answers": [ {"text": "A", "correct": true}, {"text": "B"}, {"text": "C"}, {"text": "D"} ], "explanation": "optional one-liner", "difficulty": 1|2|3, "points": 100, "hint": "optional clue" }
    RULES: boolean needs exactly 2 answers (True/False). multiple needs 4 answers and EXACTLY ONE correct.
- multi:              same as multiple BUT 2 or more answers have "correct": true
- fill:               { "type": "fill", "question": "...", "correctText": "answer", "explanation": "...", "hint": "..." } — correctText may list alternatives separated by | like "JFK|Kennedy". IMPORTANT: correctText must contain ONLY the answer itself — never the whole sentence or equation. For "12 × 12 = ___" use correctText "144", NOT "12 × 12 = 144".
- order:              { "type": "order", "question": "Put these in order:", "answers": [ {"text": "first"}, {"text": "second"}, {"text": "third"} ] } — IMPORTANT: answers MUST be listed in the CORRECT order in the JSON
- match:              { "type": "match", "question": "Match A to B:", "pairs": [ {"left": "Thing", "right": "Its pair"}, ... ] }
- numeric:            { "type": "numeric", "question": "...", "answer": 42, "tolerance": 0.5, "explanation": "..." }
- open:               { "type": "open", "question": "..." } — no answers, self-graded
- hotspot:            { "type": "hotspot", "question": "Click the...", "image": "https://image-url.png", "hotspots": [ {"x": 50, "y": 50, "r": 8, "label": "target"} ] } — x/y are percentages of image size, r is % radius

COMMON FIELDS ON EVERY QUESTION (all optional): explanation, hint, difficulty (1=easy 2=medium 3=hard), points (default 100; recommended: difficulty×100), timeLimit (seconds, overrides quiz default), image (URL).`;

const RULES = `HARD RULES — violations mean the file is rejected:
1. Output ONLY raw JSON. No markdown code fences (\`\`\`), no "Here's your quiz:", no commentary before or after. The very first character must be { and the last must be }.
2. Valid JSON: double quotes only, no trailing commas, no comments, escape any double quotes inside strings as \\".
3. Every multiple-choice question has EXACTLY ONE correct answer. Every "multi" has 2+. No answer with "correct": true repeated accidentally.
4. Order questions: answers appear in the correct order in the JSON.
5. difficulty is exactly 1, 2 or 3. points is a positive number.
6. No duplicate or near-duplicate questions.
7. The result must parse with JSON.parse on the first try.`;

const EXAMPLE = `EXAMPLE OF ONE VALID QUESTION OBJECT:
{ "type": "multiple", "question": "What is the capital of France?", "answers": [ {"text": "Paris", "correct": true}, {"text": "Lyon"}, {"text": "Marseille"}, {"text": "Nice"} ], "explanation": "Paris has been the capital since the 10th century.", "difficulty": 1, "points": 100, "hint": "It has the Eiffel Tower." }`;

/* ---------------- tone / audience voices ---------------- */

function roleLine(f: PromptFields): string {
  const voices: Record<Tone, string> = {
    fun: "You are a fun quiz host with a playful, surprising voice.",
    serious: "You are a rigorous quiz author. Accuracy is everything.",
    dramatic: "You are writing for a stylish game in the spirit of Persona 5 — dramatic, confident, theatrical.",
  };
  const audiences: Record<Audience, string> = {
    kids: "The players are KIDS — keep language simple, avoid adult or disturbing content, keep questions short.",
    teens: "The players are teenagers — keep it lively and modern, avoid obscure trivia.",
    adults: "The players are adults — assume general knowledge.",
    experts: "The players are EXPERTS in the subject — questions must be deep and challenging.",
  };
  return `${voices[f.tone]} ${audiences[f.audience]}`;
}

function typePlan(f: PromptFields): string {
  const wanted = f.types.length ? f.types : ["multiple"];
  const lines: string[] = [];
  const perType = Math.max(1, Math.floor(f.count / wanted.length));
  let assigned = 0;
  const sorted = [...wanted].sort((a, b) => (a === "multiple" ? -1 : b === "multiple" ? 1 : 0));
  sorted.forEach((t, i) => {
    const n = i === sorted.length - 1 ? Math.max(1, f.count - assigned) : perType;
    assigned += n;
    switch (t) {
      case "multiple":
        lines.push(`- ${n} × "multiple" (4 answers, exactly one correct).`);
        break;
      case "boolean":
        lines.push(`- ${n} × "boolean" (True/False).`);
        break;
      case "multi":
        lines.push(`- ${n} × "multi" with 2-3 correct answers — distractors close but clearly wrong.`);
        break;
      case "fill":
        lines.push(`- ${n} × "fill" — use | in correctText for accepted alternatives.`);
        break;
      case "order":
        lines.push(`- ${n} × "order" — answers listed in the correct order in the JSON; the question text must state the wanted order.`);
        break;
      case "match":
        lines.push(`- ${n} × "match" — one-to-one pairs, 4+ pairs each.`);
        break;
      case "numeric":
        lines.push(`- ${n} × "numeric" — answer as a plain number with a sensible tolerance (0 for exact counts).`);
        break;
      case "open":
        lines.push(`- ${n} × "open" — thoughtful, worth self-grading.`);
        break;
      case "hotspot":
        lines.push(`- ${n} × "hotspot" — only if you can provide a real working image URL relevant to the question; otherwise replace with "multiple".`);
        break;
    }
  });
  return lines.join("\n");
}

function difficultyLine(f: PromptFields): string {
  const [e, m, h] = DIFF_SPLIT[f.difficulty];
  return `Difficulty mix: ${e}% difficulty 1, ${m}% difficulty 2, ${h}% difficulty 3.`;
}

function bloomsLine(f: PromptFields): string {
  const map: Record<Blooms, string> = {
    recall: "Cognitive level: RECALL — direct memory questions (names, dates, definitions).",
    apply: "Cognitive level: APPLY — questions that require using knowledge in scenarios, calculations, or examples.",
    analyze: "Cognitive level: ANALYZE — questions that require comparing, inferring, or spotting what's wrong.",
    mix: "Cognitive level: mix of recall, apply, and analyze questions.",
  };
  return map[f.blooms];
}

function spacedLine(f: PromptFields): string {
  return `SPACED REPETITION STRUCTURE: split the quiz into ${Math.max(2, Math.min(f.sections + 2, 5))} sections labeled "Session 1", "Session 2", ... in order of increasing difficulty — earlier sessions cover fundamentals, later sessions revisit the same ideas harder.`;
}

function langLearnLine(f: PromptFields): string {
  if (!f.targetLang || !f.nativeLang) return "";
  return `LANGUAGE LEARNING: the questions teach ${f.targetLang} to a ${f.nativeLang} speaker. Prefer "fill" and "multiple" types that test vocabulary, translations, and short phrases. Keep example sentences natural.`;
}

function answerKeyLine(): string {
  return `TEACHER MODE: after the quiz JSON, also output a compact answer key as a plain list: "Q1: answer — Q2: answer — ..." (this part may be plain text, not JSON).`;
}

/* ---------------- builders ---------------- */

export function buildPrompt(f: PromptFields): string {
  if (f.interview) return buildInterviewPrompt(f);
  const topic = f.topic.trim() || "[TOPIC]";
  const lines: string[] = [];
  lines.push(`${roleLine(f)}\nCreate a quiz about "${topic}". The quiz loads into a quiz game that reads a JSON file, so output an object matching the schema below EXACTLY.`);
  if (f.language && f.language.toLowerCase() !== "english") {
    lines.push(`Write all content in ${f.language}.`);
  }
  lines.push(SCHEMA_REF);
  lines.push(RULES);
  lines.push(`QUIZ REQUIREMENTS:
- Title: ${f.title.trim() || `a catchy title about ${topic}`}.
- ${f.count} questions total, split into ${f.sections} section${f.sections > 1 ? "s" : ""} with short names.`);
  if (f.spaced) lines.push(spacedLine(f));
  lines.push(`- Question types (these exact counts):`);
  lines.push(typePlan(f));
  lines.push(`- ${difficultyLine(f)}`);
  if (f.mode !== "standard") {
    lines.push(`- Game mode: "${f.mode}".${f.mode === "survival" ? " Player has 3 hearts — questions must be fair to a knowledgeable player." : ""}${f.mode === "rapid" ? " Questions must be answerable in 8 seconds: short text, obvious choices." : ""}`);
  }
  lines.push(`- settings: "timeLimit": ${f.timeLimit ?? "null"}, "shuffle": true${f.negativeMarking ? ', "negativeMarking": true' : ""}.`);
  if (f.explanations) lines.push(`- EVERY question gets an "explanation" — max 2 short sentences, teaches something, never just repeats the answer.`);
  if (f.hints) lines.push(`- EVERY question gets a "hint" that guides without giving the answer away.`);
  lines.push(`- ${bloomsLine(f)}`);
  if (f.targetLang && f.nativeLang) lines.push(`- ${langLearnLine(f)}`);
  if (f.answerKey) lines.push(`- ${answerKeyLine()}`);
  if (f.exampleEmbed) lines.push(`- Match the tone and format of this example exactly:\n${EXAMPLE}`);
  if (f.notes.trim()) {
    lines.push(`- EXTRA REQUIREMENTS FROM THE USER — follow these exactly:\n  ${f.notes.trim()}`);
  }
  if (!f.exampleEmbed) lines.push(EXAMPLE);
  lines.push("Write the complete quiz JSON now. Verify it mentally against every hard rule, then output the raw JSON only.");
  return lines.join("\n\n");
}

/* ---------------- interview master prompt ---------------- */

const TYPE_LABEL: Record<QuestionType, string> = {
  multiple: "multiple choice (4 answers, one correct)",
  boolean: "true/false",
  multi: "multi-pick (2-3 correct)",
  fill: "fill-in the blank",
  order: "put-in-order",
  match: "matching pairs",
  numeric: "numeric answer",
  open: "open / self-graded",
  hotspot: "click-the-image hotspot",
};

/* what the builder already knows — the AI must not re-ask these */
function knownLines(f: PromptFields): string[] {
  const out: string[] = [];
  const topic = f.topic.trim();
  if (topic) out.push(`- Topic / subject: "${topic}"`);
  if (f.title.trim()) out.push(`- Title: "${f.title.trim()}"`);
  out.push(`- Quiz content language: ${f.language}`);
  out.push(`- Audience: ${f.audience}`);
  out.push(`- Length: ${f.count} questions across ${f.sections} section${f.sections === 1 ? "" : "s"}`);
  if (f.spaced) out.push(`- Structure: spaced repetition, "Session 1" onward in rising difficulty`);
  const types = f.types.length ? f.types : (["multiple"] as QuestionType[]);
  out.push(`- Question types: ${types.map((x) => TYPE_LABEL[x]).filter(Boolean).join(", ")}`);
  const [e, m, h] = DIFF_SPLIT[f.difficulty];
  out.push(`- Difficulty mix: ${e}% easy / ${m}% medium / ${h}% hard`);
  out.push(`- Tone: ${f.tone}`);
  out.push(`- Game mode: ${f.mode}; time per question: ${f.timeLimit ?? "none (untimed)"}`);
  out.push(`- Explanations: ${f.explanations ? "yes" : "no"}; hints: ${f.hints ? "yes" : "no"}; negative marking: ${f.negativeMarking ? "yes" : "no"}`);
  if (f.answerKey) out.push("- Teacher answer key: yes (output it after the JSON)");
  if (f.exampleEmbed) out.push("- Match the sample question's format and tone exactly");
  if (f.targetLang && f.nativeLang) out.push(`- Language-learning quiz: teach ${f.targetLang} to a ${f.nativeLang} speaker`);
  if (f.notes.trim()) out.push(`- Extra requirements from the user (follow exactly): ${f.notes.trim()}`);
  return out;
}

export function buildInterviewPrompt(f: PromptFields): string {
  const topic = f.topic.trim();
  const known = knownLines(f);
  const unknown: string[] = [];
  if (!topic) unknown.push("the exact topic and its scope (what is in, what is out)");
  if (!f.title.trim()) unknown.push("the title (or confirm you should invent one)");

  const L: string[] = [];
  L.push(roleLine(f));
  L.push("");
  L.push("YOUR TASK — INTERVIEW ME, THEN BUILD:");
  L.push("You are going to write a quiz for me. Think of it as me filling in a quiz builder — except YOU do the asking, so I get to control far more than a fixed form would allow. Interview me in two short rounds, then output the finished quiz file in one go.");
  L.push("");
  L.push("ROUND 1 — THE ESSENTIALS (only what is missing):");
  L.push("1. Ask ONE question at a time. Never dump a list of questions.");
  L.push('2. Each question gives 2-5 short lettered options (a, b, c...) and marks your recommendation with "(recommended)". I can answer with a letter, several letters, or my own words.');
  L.push("3. At most 5 questions in this round, and only about things that are genuinely missing or ambiguous. Never ask about anything already settled below.");
  L.push('4. If I say "go", "build", "default", "surprise me" or "just build it" at ANY point — stop asking and build immediately using your recommended defaults.');
  L.push('5. With each question, briefly note what you will assume if I answer "default".');
  L.push("");
  L.push("ROUND 2 — THE DEEP MENU (the fun part — this is how I choose a lot more):");
  L.push('Once the essentials are settled, offer me ONE compact numbered menu (8-14 lines) of optional things to tune, including things a form would never ask. For every line, state the default you would use if I skip it. Then say I can reply with the numbers I want to change (several at once), or "all", "default", or "skip".');
  L.push("Draw the menu from these (drop lines that do not apply, merge or add your own if genuinely useful):");
  L.push("- exact scope: which subtopics, eras, people or facts MUST be covered, and what to avoid (spoilers, sensitive or dated material)");
  L.push("- section plan: how many sections, each one's theme, names, and difficulty curve (warm-up opening → boss round finale?)");
  L.push("- question style: wording length, narrator voice (playful / formal / dramatic), how tricky the wrong answers should be, trick questions allowed or strictly fair");
  L.push("- framing: is this a heist, a school exam, a game show, a mystery? recurring characters or narrator?");
  L.push("- difficulty mix and reading level: kids-safe and simple, or deep expert-level?");
  L.push("- exam alignment: follow a syllabus, exam board or certification outline?");
  L.push("- humor and references: how modern/meme-y, or plain and timeless?");
  L.push("- per-question extras: hints, explanations, images (hotspot rounds need real image URLs), per-question time limits, point values");
  L.push("- game mode and pacing: standard / practice / survival / rapid / endless, seconds per question, instant feedback or results at the end");
  L.push("- shuffle rules: shuffle questions? shuffle answer order? negative marking? pass score?");
  L.push("- presentation: accent color, one-line description, author name, section emoji or Persona-5-style flavour text");
  L.push("- extras after the JSON as plain text: teacher answer key, study notes, a short revision list (I copy only the JSON block)");
  L.push("If I pick items: ask ONE short follow-up round covering just those, then build. If I skip everything: build straight away with your defaults.");
  L.push("");
  L.push("WHAT IS ALREADY SETTLED (do NOT ask about these unless something is empty or contradictory):");
  L.push(known.join("\n"));
  L.push("");
  if (unknown.length) {
    L.push("WHAT YOU MAY STILL NEED TO ASK:");
    L.push(unknown.map((u) => "- " + u).join("\n"));
  }
  L.push("");
  L.push("WHEN THE INTERVIEW IS DONE — BUILD THE QUIZ:");
  L.push('Output the quiz JSON ONLY. The very first character must be an opening curly brace and the last must be a closing curly brace. No markdown fences, no "here is your quiz", no commentary, and no questions after this point. Everything I chose must be reflected in the file.');
  L.push("");
  L.push(SCHEMA_REF);
  L.push("");
  L.push(RULES);
  L.push("");
  L.push("QUIZ REQUIREMENTS TO HONOR IN THE FINAL BUILD:");
  L.push("- " + f.count + " questions total, split into " + f.sections + " section" + (f.sections > 1 ? "s" : "") + " with short names.");
  L.push("- Question types (these exact counts):");
  L.push(typePlan(f));
  L.push("- " + difficultyLine(f));
  L.push("- " + bloomsLine(f));
  L.push('- settings: "timeLimit": ' + (f.timeLimit ?? "null") + ', "shuffle": true' + (f.negativeMarking ? ', "negativeMarking": true' : "") + ".");
  if (f.explanations) L.push('- EVERY question gets an "explanation" — max 2 short sentences, never just repeats the answer.');
  if (f.hints) L.push('- EVERY question gets a "hint" that guides without giving the answer away.');
  if (f.spaced) L.push("- " + spacedLine(f));
  if (f.targetLang && f.nativeLang) L.push("- " + langLearnLine(f));
  if (f.answerKey) L.push("- " + answerKeyLine());
  L.push("");
  L.push(EXAMPLE);
  L.push("");
  L.push("Now greet me and start ROUND 1 with your FIRST question (lettered options, your recommendation, and the default you would use). Interview first — build only when I say go or when nothing is left to ask.");
  return L.join("\n");
}

export function buildFollowUpPrompt(f: PromptFields, extra = ""): string {
  const topic = f.topic.trim() || "[TOPIC]";
  return `You previously generated a quiz about "${topic}" with this exact schema and rules. Now generate ${Math.max(3, Math.ceil(f.count / 2))} MORE questions about the same topic — similar style, NO repeats of previous questions, slightly harder on average.
${extra ? `FOCUS ON THESE AREAS (the player missed them):\n${extra}\n` : ""}
Same schema, same output rules (raw JSON only, no fences): sections with the same names as before.
${RULES}`;
}

export function buildMissPrompt(topic: string, misses: string[], extraNotes = ""): PromptFields {
  const f = defaultFields();
  f.topic = topic;
  f.title = `${topic} — Retest`;
  f.count = Math.max(5, Math.min(20, misses.length + 5));
  f.mode = "practice";
  f.timeLimit = null;
  f.explanations = true;
  f.hints = true;
  f.notes =
    `This is a targeted retest. The player previously missed these questions — generate similar (NOT identical) questions that test the same concepts:\n- ${misses.join("\n- ")}${extraNotes ? `\n${extraNotes}` : ""}`;
  return f;
}

/* ---------------- estimates / viz helpers ---------------- */

export function estimatePlayTime(f: PromptFields): number {
  const perQ = f.mode === "rapid" ? 8 : f.timeLimit ?? 20;
  return Math.round((f.count * perQ + 30) / 60);
}

export function estimateXp(f: PromptFields): number {
  return f.count * 10 + (f.difficulty === "brutal" ? 50 : f.difficulty === "chill" ? 10 : 25);
}

export function vagueTopics(topic: string): string | null {
  const t = topic.trim().toLowerCase();
  const vague = ["history", "math", "maths", "science", "quiz", "test", "stuff", "things", "general knowledge", "music", "movies", "sports", "geography"];
  if (t.length < 3) return "Topic is empty or too short — the AI will guess wildly. Try something like 'WW2 Pacific theatre' or 'cell biology'.";
  if (vague.includes(t)) return `"${topic}" is vague — the AI will guess. Try narrowing it: "French Revolution causes", "organic chemistry basics"…`;
  return null;
}

/* ---------------- 15 presets ---------------- */

function mk(
  id: string, title: string, tagline: string, tags: string[],
  over: Partial<PromptFields> & { topic?: string },
): Preset {
  return {
    id, title, tagline, tags, kind: "builtin",
    fields: { ...defaultFields(), topic: "", ...over, title: "" },
  };
}

export const BUILTIN_PRESETS: Preset[] = [
  mk("interview", "Master Prompt — Interview", "Answers a few quick questions, then the AI builds the quiz.", ["interview", "guided", "any topic"], {
    interview: true, count: 10, sections: 2, audience: "adults",
  }),
  mk("universal", "Universal Quiz", "The one prompt to rule them all — any topic, clean multiple choice.", ["multiple choice", "any topic", "safe default"], {
    types: ["multiple", "fill"], count: 10, sections: 2, audience: "adults",
  }),
  mk("alltypes", "All 9 Types Showcase", "Uses every question type the engine supports — the full arsenal.", ["9 types", "match", "order", "hotspot", "numeric"], {
    types: ["multiple", "boolean", "multi", "fill", "order", "match", "numeric", "open", "hotspot"],
    count: 12, sections: 2, explanations: true, exampleEmbed: true,
  }),
  mk("study", "Study / Revision Mode", "Heavy explanations, hints on everything — built for learning.", ["study", "explanations", "hints", "practice"], {
    types: ["multiple", "boolean", "fill", "numeric"], count: 12, sections: 3,
    mode: "practice", timeLimit: null, explanations: true, hints: true,
    blooms: "mix", tone: "serious", audience: "teens",
  }),
  mk("party", "Party / Casual Fun", "Light, funny, opinion-flavored — perfect for game night.", ["fun", "casual", "groups", "quick"], {
    types: ["multiple", "boolean", "fill"], count: 10, sections: 1,
    mode: "standard", timeLimit: 15, difficulty: "chill", tone: "fun",
  }),
  mk("exam", "Exam Simulation", "Timed pressure, negative marking, hard mode — the real deal.", ["hard", "timed", "negative marking", "exam prep"], {
    types: ["multiple"], count: 15, sections: 3, mode: "standard", timeLimit: 30,
    difficulty: "brutal", negativeMarking: true, tone: "serious", audience: "adults",
    explanations: true, blooms: "analyze",
  }),
  mk("persona", "P5-Style Themed Quiz", "Styled for this very site — red, dramatic, sections as Palaces.", ["themed", "sections", "dramatic", "trivia night"], {
    types: ["multiple", "boolean", "fill", "order"], count: 10, sections: 3,
    tone: "dramatic", timeLimit: 25, explanations: true,
  }),
  mk("engine", "Custom Engine Settings", "Full control — survival hearts, rapid-fire, endless mode.", ["survival", "rapid", "endless", "advanced"], {
    types: ["multiple", "boolean", "fill"], count: 10, sections: 1,
    mode: "rapid", timeLimit: 8, tone: "fun",
  }),
  mk("language", "Language Learning", "Vocab, translations and phrases — target ↔ native pairing.", ["languages", "vocab", "translation", "phrases"], {
    types: ["multiple", "fill", "match"], count: 12, sections: 2,
    mode: "practice", timeLimit: null, explanations: true, hints: true,
    tone: "serious", targetLang: "Japanese", nativeLang: "English", blooms: "recall",
  }),
  mk("history", "History & Dates", "Timelines, causes, consequences — with order questions.", ["history", "dates", "timeline", "order"], {
    types: ["multiple", "order", "fill", "boolean"], count: 12, sections: 3,
    tone: "serious", explanations: true, audience: "teens", blooms: "recall",
  }),
  mk("science", "Science Facts", "Physics, chemistry, biology — numeric answers welcome.", ["science", "facts", "numeric", "curiosity"], {
    types: ["multiple", "numeric", "fill", "boolean"], count: 12, sections: 3,
    tone: "serious", explanations: true, blooms: "apply",
  }),
  mk("popculture", "Pop Culture & Music", "Movies, games, music — decade-spanning trivia.", ["pop culture", "music", "movies", "games"], {
    types: ["multiple", "boolean", "fill"], count: 10, sections: 2,
    tone: "fun", timeLimit: 20, difficulty: "chill", audience: "teens",
  }),
  mk("kids", "Kids Mode", "Simple words, safe topics, big wins for small players.", ["kids", "simple", "safe", "family"], {
    types: ["multiple", "boolean", "fill"], count: 8, sections: 1,
    audience: "kids", difficulty: "chill", tone: "fun", timeLimit: 25, explanations: true,
  }),
  mk("interview", "Interview / Cert Prep", "Technical depth with apply-and-analyze questions.", ["interview", "certification", "technical", "career"], {
    types: ["multiple", "multi", "fill", "numeric"], count: 15, sections: 4,
    audience: "experts", difficulty: "brutal", tone: "serious", timeLimit: 30,
    explanations: true, blooms: "apply", negativeMarking: true,
  }),
];

/* The JSON fixer stays static — it repairs, not generates. */
export const FIXER_PROMPT = {
  id: "fixer",
  title: "JSON Fixer",
  tagline: "Paste broken quiz JSON — get it repaired and schema-compliant.",
  tags: ["repair", "validate", "migrate"],
  text: `You are a JSON repair specialist. I will paste a quiz JSON that may be broken or in a different format. Your job: return a corrected, complete quiz in the schema below, preserving the questions and content as faithfully as possible. Output raw JSON only.

${SCHEMA_REF}

${RULES}

REPAIR REQUIREMENTS:
- Fix syntax: unclosed braces, trailing commas, single quotes, comments.
- Migrate common formats: {"question":..., "options":[...]} or {"choices":[...]} → answers array with correct flags; {"answer": "text"} → fill/numeric as appropriate.
- If a question's correct answer is ambiguous or missing, infer it from context; if truly unknowable, mark one plausible answer correct and note it in the explanation as "verify this answer".
- Ensure every question matches the rules (exactly one correct for multiple, etc).
- Keep title/description; fill missing fields with sensible defaults.
- NEVER invent new questions. NEVER drop questions.

EXAMPLE INPUT: {"title":"X","questions":[{"q":"2+2?","options":["4","5","6"],"answer":"4"}]}
EXAMPLE OUTPUT: { "title": "X", "sections": [ { "name": "Main", "questions": [ { "type": "multiple", "question": "2+2?", "answers": [ {"text": "4", "correct": true}, {"text": "5"}, {"text": "6"} ], "explanation": "", "difficulty": 1 } ] } ] }`,
};

/* merge two presets: take the first's topic/voice, the second's types/mode/extras */
export function mergeFields(a: PromptFields, b: PromptFields): PromptFields {
  return {
    ...a,
    types: b.types.length ? b.types : a.types,
    mode: b.mode,
    timeLimit: b.timeLimit,
    difficulty: b.difficulty,
    negativeMarking: a.negativeMarking || b.negativeMarking,
    explanations: a.explanations || b.explanations,
    hints: a.hints || b.hints,
    answerKey: a.answerKey || b.answerKey,
    blooms: a.blooms === "mix" ? b.blooms : a.blooms,
    spaced: a.spaced || b.spaced,
    targetLang: b.targetLang ?? a.targetLang,
    nativeLang: b.nativeLang ?? a.nativeLang,
    notes: [a.notes, b.notes].filter(Boolean).join(" "),
    count: Math.max(a.count, b.count),
    sections: Math.max(a.sections, b.sections),
    audience: b.audience === "adults" && a.audience !== "adults" ? a.audience : b.audience,
  };
}
