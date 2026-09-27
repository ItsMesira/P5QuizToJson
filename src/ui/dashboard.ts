/* ============ P5 QUIZ — CLASS DASHBOARD (members, quiz hub, class leaderboard) ============ */
import gsap from "gsap";
import { registerScreen, go, startQuiz } from "./screens";
import { h, toast } from "./dom";
import { audio } from "../core/audio";
import { fx } from "../fx/particles";
import { RM } from "../fx/transitions";
import { cloud, cloudError, type QuizListRow } from "../core/api";
import { validateQuiz } from "../core/validator";
import { saveQuiz, savedQuizzes } from "../core/store";
import { t } from "../core/i18n";

const HUB_LIMIT = 60;
const HUB_ROWS = 6;

const newestFirst = (a: QuizListRow, b: QuizListRow) => String(b.created ?? "").localeCompare(String(a.created ?? ""));

registerScreen("dashboard", (root) => {
  const session = cloud.session;
  if (!session) {
    void go({ name: "entry" }, { instant: true });
    return () => undefined;
  }

  const cls = session.cls;
  const isTeacher = cls?.role === "teacher";

  let quizzes: QuizListRow[] = [];
  let hubTotal = 0;
  let hubPinned: QuizListRow[] = [];
  let hubLoaded = false;
  let hubError: string | null = null;
  let hubGen = 0;

  const el = h("div", { class: "screen dashboard-screen" }, [
    h("header", { class: "load-head" }, [
      h("button", { class: "back-btn", "aria-label": t("Back") }, ["◀"]),
      h("h2", { class: "screen-title" }, [t("CLASSROOM")]),
      h("div", { class: "head-spacer" }, []),
    ]),
    h("div", { class: "dash-body" }, [
      cls
        ? h("div", { class: "dash-hero" }, [
            h("div", { class: "dash-classname" }, [cls.name]),
            h("div", { class: "dash-code" }, [
              h("span", { class: "dash-code-label" }, [t("JOIN CODE:")]),
              h("span", { class: "dash-code-value" }, [cls.code]),
              h("button", { class: "lib-btn dash-copy" }, [t("⧉ COPY")]),
            ]),
            h("div", { class: "dash-role" }, [`${t(cls.role.toUpperCase())} · ${session.user.username}`]),
          ])
        : h("div", { class: "dash-empty" }, [
            h("div", { class: "dash-empty-title" }, [t("NO CLASSROOM YET")]),
            h("p", { class: "dash-empty-sub" }, [t("Join with a class code from your teacher, or start your own class.")]),
          ]),
      cls
        ? h("div", { class: "dash-columns" }, [
            h("section", { class: "dash-col" }, [
              h("h3", { class: "dash-head" }, [t("— MEMBERS —")]),
              h("div", { class: "dash-members" }, [h("p", { class: "profile-empty" }, [t("Loading…")])]),
            ]),
            h("section", { class: "dash-col dash-col-shelf" }, [
              h("h3", { class: "dash-head" }, [t("— CLASS QUIZ SHELF —")]),
              h("div", { class: "dash-quiz-list dash-hub" }, [h("p", { class: "profile-empty" }, [t("Loading…")])]),
              h("button", { class: "lib-btn dash-viewall" }, [t("VIEW ALL →")]),
              h("button", { class: "sticker-btn accent dash-add" }, [t("＋ ADD A QUIZ")]),
            ]),
            h("section", { class: "dash-col" }, [
              h("h3", { class: "dash-head" }, [t("— CLASS LEADERBOARD —")]),
              h("div", { class: "dash-board" }, [h("p", { class: "profile-empty" }, [t("Loading…")])]),
            ]),
          ])
        : null,
      h("div", { class: "dash-actions" }, [
        h("button", { class: "sticker-btn dash-home" }, ["⌂ TITLE"]),
        h("button", { class: "sticker-btn dash-switch" }, [cls ? t("⇄ SWITCH CLASS") : t("⇄ JOIN / MAKE A CLASS")]),
        h("button", { class: "sticker-btn accent dash-play" }, [t("▶ PLAY SOLO")]),
        h("button", { class: "sticker-btn dash-logout" }, [t("✕ LOG OUT")]),
      ]),
    ]),
    /* add-quiz dialog (fixed overlay) */
    h("div", { class: "dash-add-modal hidden" }, [
      h("div", { class: "dash-add-card", role: "dialog", "aria-label": t("Add a quiz") }, [
        h("div", { class: "dash-add-head" }, [
          h("h3", {}, [t("ADD A QUIZ")]),
          h("button", { class: "pm-close add-close", "aria-label": t("Close") }, ["✕"]),
        ]),
        h("div", { class: "dash-add-target" }, [t("Adding to: {name}", { name: cls?.name ?? "" })]),
        h("div", { class: "dash-add-tabs" }, [
          h("button", { class: "dash-add-tab active", "data-pane": "paste" }, [t("📋 PASTE")]),
          h("button", { class: "dash-add-tab", "data-pane": "file" }, [t("📂 FILE")]),
          h("button", { class: "dash-add-tab", "data-pane": "saved" }, [t("⭐ MY SAVED")]),
          h("button", { class: "dash-add-tab", "data-pane": "samples" }, [t("★ SAMPLES")]),
        ]),
        h("div", { class: "dash-add-error" }, []),
        h("div", { class: "dash-add-pane", "data-pane": "paste" }, [
          h("textarea", { class: "dash-add-area", placeholder: '{ "title": "My Quiz", "sections": [...] }', spellcheck: "false" }, []),
          h("button", { class: "sticker-btn accent dash-add-submit" }, [t("ADD TO CLASS")]),
        ]),
        h("div", { class: "dash-add-pane hidden", "data-pane": "file" }, [
          h("button", { class: "sticker-btn accent dash-add-browse" }, [t("📂 CHOOSE A .JSON FILE")]),
        ]),
        h("div", { class: "dash-add-pane hidden", "data-pane": "saved" }, [h("div", { class: "dash-add-list" }, [])]),
        h("div", { class: "dash-add-pane hidden", "data-pane": "samples" }, [h("div", { class: "dash-add-samples" }, [])]),
      ]),
    ]),
  ]);

  el.querySelector(".back-btn")!.addEventListener("click", () => void go({ name: "title" }));
  el.querySelector(".back-btn")!.addEventListener("mouseenter", () => audio.sfx("hover"));

  /* ---- copy join code ---- */
  el.querySelector(".dash-copy")?.addEventListener("click", async () => {
    if (!cls) return;
    await navigator.clipboard.writeText(cls.code).catch(() => undefined);
    audio.sfx("stamp");
    toast(t("Code {code} copied", { code: cls.code }), "info");
  });

  /* ---- actions ---- */
  el.querySelector(".dash-home")!.addEventListener("click", () => void go({ name: "title" }));
  el.querySelector(".dash-switch")!.addEventListener("click", () => void go({ name: "entry" }));
  el.querySelector(".dash-play")!.addEventListener("click", () => void go({ name: "load" }));
  el.querySelector(".dash-logout")!.addEventListener("click", async () => {
    await cloud.logout().catch(() => undefined);
    cloud.setSession(null);
    toast(t("Logged out"), "info");
    void go({ name: "entry" });
  });

  /* ---- quiz hub (pinned + recent). The shelf column only exists when the user
     HAS a class, so these lookups can be null; never non-null assert them. ---- */
  const hubBox = el.querySelector<HTMLElement>(".dash-hub");
  const viewAllBtn = el.querySelector<HTMLButtonElement>(".dash-viewall");

  viewAllBtn?.addEventListener("click", () => void go({ name: "class-library" }));

  function hubSection(kind: "pinned" | "recent", title: string, rows: QuizListRow[], highlightId?: string): HTMLElement {
    return h("section", { class: "dash-hub-section", "data-hub": kind }, [
      h("div", { class: "dash-hub-title" }, [title]),
      ...rows.map((q) => quizCard(q, highlightId === q.id)),
    ]);
  }

  /* A successful action re-renders the card, so the button guard alone cannot
     stop a second click landing right after the response; keep a short per-quiz
     cooldown that survives re-render. */
  const busyUntil = new Map<string, number>();
  const busy = (id: string, kind: "pin" | "del") => (busyUntil.get(`${id}:${kind}`) ?? 0) > Date.now();

  function quizCard(q: QuizListRow, highlight: boolean): HTMLElement {
    const meta = [t("by {author}", { author: q.author })];
    if (q.created) meta.push(new Date(q.created).toLocaleDateString());
    if (q.plays > 0) meta.push(`▶ ${q.plays}`);
    const card = h("div", { class: `qcard${q.pinned ? " pinned" : ""}`, "data-qid": q.id }, [
      h("div", { class: "qcard-title" }, [q.title]),
      h("div", { class: "qcard-meta" }, [meta.join(" · ")]),
      h("div", { class: "qcard-actions" }, [
        h("button", { class: "lib-btn play qcard-play" }, [t("▶ PLAY")]),
        isTeacher
          ? h("button", { class: "lib-btn qcard-pin", "aria-pressed": q.pinned ? "true" : "false" }, [q.pinned ? t("PINNED") : t("📌 PIN")])
          : null,
        isTeacher ? h("button", { class: "lib-btn danger qcard-del", "aria-label": t("Delete quiz") }, ["✕"]) : null,
      ]),
    ]);
    card.querySelector(".qcard-play")!.addEventListener("click", async () => {
      audio.sfx("select");
      const r = await cloud.fetchQuiz(cls!.id, q.id);
      if (r.ok && r.data.quiz) {
        const v = validateQuiz(r.data.quiz);
        if (v.ok) {
          saveQuiz(v.quiz, `class:${cls!.name}`);
          await startQuiz({ ...v.quiz, source: `class:${cls!.name}`, quizId: q.id });
        } else {
          toast(t("That quiz is broken"), "error");
        }
      } else {
        toast(cloudError(r), "error");
      }
    });
    const pinBtn = card.querySelector<HTMLButtonElement>(".qcard-pin");
    pinBtn?.addEventListener("click", async () => {
      if (pinBtn.disabled || busy(q.id, "pin")) return;
      busyUntil.set(`${q.id}:pin`, Date.now() + 500);
      pinBtn.disabled = true;
      const next = !q.pinned;
      const r = await cloud.pinQuiz(cls!.id, q.id, next);
      if (!r.ok) {
        pinBtn.disabled = false;
        toast(cloudError(r), "error");
        return;
      }
      const row = quizzes.find((x) => x.id === q.id);
      if (row) row.pinned = next;
      else q.pinned = next;
      hubPinned = hubPinned.filter((x) => x.id !== q.id);
      if (next) hubPinned = [q, ...hubPinned];
      busyUntil.set(`${q.id}:pin`, Date.now() + 500);
      renderHub();
    });
    const delBtn = card.querySelector<HTMLButtonElement>(".qcard-del");
    delBtn?.addEventListener("click", async () => {
      if (delBtn.disabled || busy(q.id, "del")) return;
      busyUntil.set(`${q.id}:del`, Date.now() + 500);
      delBtn.disabled = true;
      const r = await cloud.deleteQuiz(cls!.id, q.id);
      if (!r.ok) delBtn.disabled = false;
      if (r.ok) {
        audio.sfx("paper");
        toast(t("Quiz removed from the class"), "info");
        quizzes = quizzes.filter((x) => x.id !== q.id);
        hubPinned = hubPinned.filter((x) => x.id !== q.id);
        hubTotal = Math.max(0, hubTotal - 1);
        busyUntil.set(`${q.id}:del`, Date.now() + 500);
        renderHub();
      } else {
        toast(cloudError(r), "error");
      }
    });
    if (highlight && !RM()) {
      gsap.fromTo(card, { scale: 0.96, backgroundColor: "rgba(230,0,18,0.35)" }, { scale: 1, backgroundColor: "rgba(0,0,0,0)", duration: 0.9, ease: "power2.out" });
    }
    return card;
  }

  function renderHub(highlightId?: string) {
    if (!hubBox || !hubLoaded) return;
    hubBox.textContent = "";
    if (viewAllBtn) viewAllBtn.textContent = t("VIEW ALL ({n}) →", { n: hubTotal });
    if (hubError) {
      hubBox.appendChild(h("p", { class: "profile-empty" }, [hubError]));
      return;
    }
    if (hubTotal === 0) {
      hubBox.appendChild(h("p", { class: "profile-empty" }, [t("No quizzes yet — ADD one below.")]));
      return;
    }
    const newest = [...quizzes].sort(newestFirst);
    const pinned = (hubPinned.length ? [...hubPinned].sort(newestFirst) : newest.filter((q) => q.pinned)).slice(0, HUB_ROWS);
    const recent = newest.slice(0, HUB_ROWS);
    if (pinned.length) hubBox.appendChild(hubSection("pinned", t("PINNED"), pinned, highlightId));
    if (recent.length) hubBox.appendChild(hubSection("recent", t("RECENT"), recent, highlightId));
    if (!RM()) {
      gsap.fromTo(hubBox.querySelectorAll(".qcard"), { y: 24, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.04, duration: 0.3, ease: "back.out(1.5)" });
    }
  }

  async function fetchHub(highlightId?: string): Promise<void> {
    if (!cls) return;
    const gen = ++hubGen;
    const [r, pr] = await Promise.all([
      cloud.listQuizzes(cls.id, { limit: HUB_LIMIT }),
      cloud.listQuizzes(cls.id, { pinned: true, limit: HUB_ROWS }),
    ]);
    if (gen !== hubGen || r.cancelled) return;
    if (r.ok && r.data.quizzes) {
      quizzes = r.data.quizzes;
      hubPinned = pr.ok && pr.data.quizzes ? pr.data.quizzes.filter((x) => x.pinned) : quizzes.filter((x) => x.pinned);
      hubTotal = typeof r.data.total === "number" ? r.data.total : quizzes.length;
      hubError = null;
      hubLoaded = true;
      renderHub(highlightId);
      return;
    }
    if (!hubLoaded) {
      hubLoaded = true;
      hubError = r.data.error ? cloudError(r) : t("Couldn't load quizzes");
      renderHub();
    } else {
      toast(cloudError(r), "error");
    }
  }

  /* ---- class switcher (hero) ---- */
  async function loadSwitcher() {
    if (!cls) return;
    const r = await cloud.myClasses();
    if (r.cancelled || !r.ok || !r.data.classes || r.data.classes.length < 2) return;
    const hero = el.querySelector<HTMLElement>(".dash-hero");
    const anchor = el.querySelector<HTMLElement>(".dash-classname");
    if (!hero || !anchor) return;
    const classes = r.data.classes;
    const activeId = r.data.activeId ?? cls.id;
    const current = classes.find((c) => c.id === activeId);
    const btn = h("button", { class: "dash-switcher-btn", type: "button", "aria-haspopup": "true", "aria-expanded": "false" }, [
      `⇄ ${current?.name ?? cls.name} ▾`,
    ]);
    const menu = h("div", { class: "dash-switcher-menu hidden" }, []);
    classes.forEach((c) => {
      const item = h("button", { class: `dash-switcher-item${c.id === activeId ? " active" : ""}`, type: "button", "data-id": c.id }, [
        h("span", { class: "dash-switcher-name" }, [c.name]),
        h("span", { class: "dash-switcher-code" }, [c.code]),
      ]);
      item.addEventListener("click", async () => {
        audio.sfx("select");
        const res = await cloud.setActiveClass(c.id);
        if (!res.ok) {
          toast(cloudError(res), "error");
          return;
        }
        const meR = await cloud.me();
        if (!meR.ok) {
          toast(cloudError(meR), "error");
          return;
        }
        void go({ name: "dashboard" });
      });
      menu.appendChild(item);
    });
    btn.addEventListener("mouseenter", () => audio.sfx("hover"));
    btn.addEventListener("click", () => {
      menu.classList.toggle("hidden");
      btn.setAttribute("aria-expanded", String(!menu.classList.contains("hidden")));
    });
    hero.insertBefore(h("div", { class: "dash-switcher" }, [btn, menu]), anchor.nextSibling);
  }

  /* ---- add-quiz dialog ---- */
  const modal = el.querySelector<HTMLElement>(".dash-add-modal")!;
  const addError = el.querySelector<HTMLElement>(".dash-add-error")!;
  const addArea = el.querySelector<HTMLTextAreaElement>(".dash-add-area")!;
  const fileInput = h("input", { type: "file", accept: ".json,application/json", class: "dash-add-file" });
  el.querySelector('.dash-add-pane[data-pane="file"]')!.appendChild(fileInput);

  const showAddError = (msg: string) => {
    addError.textContent = msg;
    addError.classList.add("open");
  };
  const clearAddError = () => {
    addError.textContent = "";
    addError.classList.remove("open");
  };

  const closeAdd = () => {
    modal.classList.add("hidden");
    clearAddError();
  };

  const openAdd = () => {
    if (!cls) return;
    modal.classList.remove("hidden");
    clearAddError();
    renderSavedPane();
    gsap.fromTo(".dash-add-card", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "back.out(1.5)" });
  };

  async function addToClass(raw: unknown): Promise<boolean> {
    if (!cls) return false;
    const v = validateQuiz(raw);
    if (!v.ok) {
      audio.sfx("wrong");
      fx.shake(10);
      showAddError(v.errors.slice(0, 2).map((e) => `${e.path} — ${e.message}`).join(" · "));
      return false;
    }
    const r = await cloud.saveQuiz(cls.id, v.quiz);
    if (!r.ok) {
      audio.sfx("wrong");
      fx.shake(10);
      showAddError(t("Couldn't add: {msg}", { msg: cloudError(r) }));
      return false;
    }
    saveQuiz(v.quiz, `class:${cls.name}`);
    audio.sfx("correct");
    const row: QuizListRow = {
      id: String(r.data.id ?? ""),
      title: v.quiz.title,
      author: session!.user.username,
      created: new Date().toISOString(),
      pinned: false,
      plays: 0,
    };
    quizzes = [row, ...quizzes.filter((x) => x.id !== row.id)];
    hubTotal += 1;
    hubLoaded = true;
    hubError = null;
    renderHub(row.id);
    toast(t("“{title}” added to {name}", { title: v.quiz.title, name: cls.name }), "info");
    closeAdd();
    void fetchHub(row.id);
    return true;
  }

  function renderSavedPane() {
    const box = el.querySelector<HTMLElement>(".dash-add-list")!;
    box.textContent = "";
    const saved = savedQuizzes().slice(0, 40);
    if (!saved.length) {
      box.appendChild(h("p", { class: "profile-empty" }, [t("Nothing saved yet — load a quiz first.")]));
      return;
    }
    saved.forEach((s) => {
      const row = h("div", { class: "dash-add-row" }, [
        h("div", { class: "dash-add-row-title" }, [s.quiz.title]),
        h("button", { class: "lib-btn play" }, [t("＋ ADD")]),
      ]);
      row.querySelector("button")!.addEventListener("click", () => void addToClass(s.quiz));
      box.appendChild(row);
    });
  }

  function renderSamplesPane() {
    const box = el.querySelector<HTMLElement>(".dash-add-samples")!;
    if (box.childElementCount) return;
    const names = ["persona5", "general", "math", "code"];
    const titles = ["P5 TRIVIA", "GENERAL KNOWLEDGE", "MATH", "CODE"];
    names.forEach((name, i) => {
      const btn = h("button", { class: "dash-add-sample" }, [t(titles[i])]);
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const res = await fetch(`./sample-quizzes/${name}.json`);
          await addToClass(await res.json());
        } catch {
          showAddError(t("Couldn't load that sample"));
        } finally {
          btn.disabled = false;
        }
      });
      box.appendChild(btn);
    });
  }

  el.querySelectorAll<HTMLElement>(".dash-add-tab").forEach((tab) => {
    tab.addEventListener("mouseenter", () => audio.sfx("hover"));
    tab.addEventListener("click", () => {
      audio.sfx("select");
      const pane = tab.getAttribute("data-pane");
      el.querySelectorAll(".dash-add-tab").forEach((x) => x.classList.toggle("active", x === tab));
      el.querySelectorAll<HTMLElement>(".dash-add-pane").forEach((p) => p.classList.toggle("hidden", p.getAttribute("data-pane") !== pane));
      if (pane === "samples") renderSamplesPane();
    });
  });

  el.querySelector(".add-close")!.addEventListener("click", closeAdd);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeAdd();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) closeAdd();
  };
  document.addEventListener("keydown", onKey);

  const submitBtn = el.querySelector<HTMLButtonElement>(".dash-add-submit")!;
  submitBtn.addEventListener("click", async () => {
    if (!addArea.value.trim()) {
      showAddError(t("Paste quiz JSON first."));
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = t("SAVING…");
    try {
      await addToClass(JSON.parse(addArea.value));
      if (modal.classList.contains("hidden")) addArea.value = "";
    } catch {
      audio.sfx("wrong");
      fx.shake(10);
      showAddError(t("Not valid JSON — check commas and quotes."));
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = t("ADD TO CLASS");
    }
  });
  el.querySelector(".dash-add-browse")!.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    fileInput.value = "";
    if (!f) return;
    try {
      await addToClass(JSON.parse(await f.text()));
    } catch {
      showAddError(t("Not valid JSON — check commas and quotes."));
    }
  });
  /* .dash-add is rendered inside the class-only shelf column, so a signed-in
     user with no class has no such button. This assertion used to throw during
     the mount, and the router's catch replaced the whole dashboard with the
     title menu — which is why a brand-new account could never reach the
     "NO CLASSROOM YET" screen. */
  el.querySelector(".dash-add")?.addEventListener("click", openAdd);

  let loading = false;

  /* ---- data ---- */
  async function loadData() {
    const membersBox = el.querySelector<HTMLElement>(".dash-members");
    const boardBox = el.querySelector<HTMLElement>(".dash-board");
    if (!cls || !membersBox || !boardBox || loading) return;
    loading = true;
    const c = cls;
    const fail = (box: HTMLElement, msg: string) => {
      box.textContent = "";
      box.appendChild(h("p", { class: "profile-empty" }, [msg]));
    };
    try {
      const [infoR, , resultsR] = await Promise.allSettled([
        cloud.classInfo(c.id),
        fetchHub(),
        cloud.classResults(c.id),
      ]);

      const info = infoR.status === "fulfilled" ? infoR.value : null;
      if (info && info.ok && info.data.members) {
        membersBox.textContent = "";
        info.data.members.forEach((m, i) => {
          const row = h("div", { class: `dash-member ${m.role === "teacher" ? "teacher" : ""}` }, [
            h("span", { class: "dash-member-role" }, [m.role === "teacher" ? "★" : "🎓"]),
            h("span", {}, [m.username]),
            m.role === "teacher" ? h("span", { class: "dash-member-tag" }, [t("TEACHER")]) : null,
          ]);
          membersBox.appendChild(row);
          if (!RM()) gsap.fromTo(row, { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, delay: i * 0.05, ease: "back.out(1.5)" });
        });
      } else {
        fail(membersBox, info?.data?.error ? cloudError(info) : t("Couldn't load members"));
      }

      const results = resultsR.status === "fulfilled" ? resultsR.value : null;
      if (results && results.ok && results.data.results) {
        boardBox.textContent = "";
        if (!results.data.results.length) {
          boardBox.appendChild(h("p", { class: "profile-empty" }, [t("No scores yet — play something!")]));
        }
        results.data.results.slice(0, 15).forEach((r, i) => {
          const row = h("div", { class: `dash-row ${i < 3 ? "podium" : ""}` }, [
            h("span", { class: "dash-row-pos" }, [i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : String(i + 1)]),
            h("span", { class: "dash-row-rank" }, [r.rank]),
            h("span", { class: "dash-row-name" }, [r.username]),
            h("span", { class: "dash-row-quiz" }, [r.quizTitle]),
            h("span", { class: "dash-row-pts" }, [`${r.points}`]),
          ]);
          boardBox.appendChild(row);
          if (!RM()) gsap.fromTo(row, { x: 30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, delay: i * 0.04, ease: "back.out(1.5)" });
        });
      } else {
        fail(boardBox, results?.data?.error ? cloudError(results) : t("Couldn't load scores"));
      }
    } catch (err) {
      console.error("[p5q] dashboard load failed:", err);
      for (const box of [membersBox, boardBox]) {
        fail(box, t("Couldn't load — check your connection and try again."));
      }
      hubLoaded = true;
      hubError = t("Couldn't load — check your connection and try again.");
      renderHub();
    } finally {
      loading = false;
    }
  }

  root.appendChild(el);
  if (cls) {
    void loadData();
    void loadSwitcher();
  }
  if (!RM()) {
    gsap.fromTo(".load-head", { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
    gsap.fromTo(".dash-hero", { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: "back.out(1.4)" });
    gsap.fromTo(".dash-col", { y: 30, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.08, duration: 0.35, ease: "back.out(1.5)", delay: 0.1 });
  }
  return () => {
    document.removeEventListener("keydown", onKey);
  };
});
