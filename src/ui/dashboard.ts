/* ============ P5 QUIZ — CLASS DASHBOARD (members, quiz shelf, class leaderboard) ============ */
import gsap from "gsap";
import { registerScreen, go, startQuiz } from "./screens";
import { h, toast } from "./dom";
import { audio } from "../core/audio";
import { fx } from "../fx/particles";
import { RM } from "../fx/transitions";
import { cloud, cloudError } from "../core/api";
import { validateQuiz } from "../core/validator";
import { saveQuiz, savedQuizzes } from "../core/store";
import { t } from "../core/i18n";

interface ShelfQuiz {
  id: string;
  title: string;
  author: string;
  created: string;
}

const PER_PAGE = 12;

registerScreen("dashboard", (root) => {
  const session = cloud.session;
  if (!session) {
    void go({ name: "entry" }, { instant: true });
    return () => undefined;
  }

  const cls = session.cls;

  let shelf: ShelfQuiz[] = [];
  let shelfLoaded = false;
  let shelfQ = "";
  let shelfSort: "newest" | "title" = "newest";
  let shelfPage = 1;

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
              h("div", { class: "dash-shelf-tools" }, [
                h("input", { class: "dash-search", type: "search", placeholder: t("Search quizzes…"), "aria-label": t("Search quizzes"), spellcheck: "false" }, []),
                h("select", { class: "dash-sort", "aria-label": t("Sort quizzes") }, [
                  h("option", { value: "newest" }, [t("NEWEST")]),
                  h("option", { value: "title" }, [t("A–Z")]),
                ]),
              ]),
              h("div", { class: "dash-quiz-list" }, [h("p", { class: "profile-empty" }, [t("Loading…")])]),
              h("div", { class: "dash-pager" }, []),
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

  /* ---- shelf ---- */
  const listBox = el.querySelector<HTMLElement>(".dash-quiz-list")!;
  const pagerBox = el.querySelector<HTMLElement>(".dash-pager")!;
  const searchInput = el.querySelector<HTMLInputElement>(".dash-search")!;
  const sortSelect = el.querySelector<HTMLSelectElement>(".dash-sort")!;

  function filtered(): ShelfQuiz[] {
    const q = shelfQ.trim().toLowerCase();
    const out = q ? shelf.filter((x) => x.title.toLowerCase().includes(q) || x.author.toLowerCase().includes(q)) : [...shelf];
    out.sort((a, b) =>
      shelfSort === "title" ? a.title.localeCompare(b.title) : String(b.created ?? "").localeCompare(String(a.created ?? "")),
    );
    return out;
  }

  function renderShelf(highlightId?: string) {
    if (!shelfLoaded) return;
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    shelfPage = Math.min(Math.max(1, shelfPage), pages);
    const start = (shelfPage - 1) * PER_PAGE;
    const slice = list.slice(start, start + PER_PAGE);
    listBox.textContent = "";
    if (!list.length) {
      listBox.appendChild(
        h("p", { class: "profile-empty" }, [
          shelf.length ? t("No quizzes match “{q}”", { q: shelfQ.trim() }) : t("No quizzes yet — ADD one below."),
        ]),
      );
    }
    slice.forEach((q) => listBox.appendChild(quizRow(q, highlightId === q.id)));

    pagerBox.textContent = "";
    if (list.length > PER_PAGE) {
      const prev = h("button", { class: "lib-btn dash-page-prev" }, ["◀"]) as HTMLButtonElement;
      const next = h("button", { class: "lib-btn dash-page-next" }, ["▶"]) as HTMLButtonElement;
      prev.disabled = shelfPage <= 1;
      next.disabled = shelfPage >= pages;
      prev.addEventListener("click", () => {
        shelfPage--;
        renderShelf();
      });
      next.addEventListener("click", () => {
        shelfPage++;
        renderShelf();
      });
      pagerBox.append(
        h("span", { class: "dash-pager-count" }, [t("Showing {a}–{b} of {n}", { a: start + 1, b: start + slice.length, n: list.length })]),
        prev,
        h("span", { class: "dash-pager-pos" }, [`${shelfPage}/${pages}`]),
        next,
      );
    }
  }

  function quizRow(q: ShelfQuiz, highlight: boolean): HTMLElement {
    const row = h("div", { class: `dash-quiz${highlight ? " highlight" : ""}`, "data-qid": q.id }, [
      h("div", { class: "dash-quiz-title" }, [q.title]),
      h("div", { class: "dash-quiz-meta" }, [t("by {author}", { author: q.author })]),
      h("div", { class: "dash-quiz-actions" }, [
        h("button", { class: "lib-btn play dash-quiz-play" }, [t("▶ PLAY")]),
        cls!.role === "teacher" ? h("button", { class: "lib-btn danger dash-quiz-del" }, ["✕"]) : null,
      ]),
    ]);
    row.querySelector(".dash-quiz-play")!.addEventListener("click", async () => {
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
    row.querySelector(".dash-quiz-del")?.addEventListener("click", async () => {
      const r = await cloud.deleteQuiz(cls!.id, q.id);
      if (r.ok) {
        audio.sfx("paper");
        toast(t("Quiz removed from the class"), "info");
        shelf = shelf.filter((x) => x.id !== q.id);
        renderShelf();
      } else {
        toast(cloudError(r), "error");
      }
    });
    if (highlight && !RM()) gsap.fromTo(row, { scale: 0.96, backgroundColor: "rgba(230,0,18,0.35)" }, { scale: 1, backgroundColor: "rgba(0,0,0,0)", duration: 0.9, ease: "power2.out" });
    return row;
  }

  searchInput.addEventListener("input", () => {
    shelfQ = searchInput.value;
    shelfPage = 1;
    renderShelf();
  });
  sortSelect.addEventListener("change", () => {
    shelfSort = sortSelect.value === "title" ? "title" : "newest";
    shelfPage = 1;
    renderShelf();
  });

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
    const row: ShelfQuiz = {
      id: String(r.data.id ?? ""),
      title: v.quiz.title,
      author: session!.user.username,
      created: new Date().toISOString(),
    };
    shelf = [row, ...shelf.filter((x) => x.id !== row.id)];
    shelfQ = "";
    shelfSort = "newest";
    shelfPage = 1;
    searchInput.value = "";
    sortSelect.value = "newest";
    shelfLoaded = true;
    renderShelf(row.id);
    toast(t("“{title}” added to {name}", { title: v.quiz.title, name: cls.name }), "info");
    closeAdd();
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

  el.querySelector(".dash-add-submit")!.addEventListener("click", async () => {
    if (!addArea.value.trim()) {
      showAddError(t("Paste quiz JSON first."));
      return;
    }
    try {
      await addToClass(JSON.parse(addArea.value));
      if (modal.classList.contains("hidden")) addArea.value = "";
    } catch {
      audio.sfx("wrong");
      fx.shake(10);
      showAddError(t("Not valid JSON — check commas and quotes."));
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
  el.querySelector(".dash-add")!.addEventListener("click", openAdd);

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
      const [infoR, quizzesR, resultsR] = await Promise.allSettled([
        cloud.classInfo(c.id),
        cloud.listQuizzes(c.id),
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

      const quizzes = quizzesR.status === "fulfilled" ? quizzesR.value : null;
      if (quizzes && quizzes.ok && quizzes.data.quizzes) {
        shelf = quizzes.data.quizzes.map((q) => ({
          id: q.id,
          title: q.title,
          author: q.author,
          created: String(q.created ?? ""),
        }));
        shelfLoaded = true;
        renderShelf();
        if (shelf.length && !RM()) {
          gsap.fromTo(".dash-quiz", { y: 24, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.04, duration: 0.3, ease: "back.out(1.5)" });
        }
      } else {
        shelfLoaded = true;
        fail(listBox, quizzes?.data?.error ? cloudError(quizzes) : t("Couldn't load quizzes"));
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
      shelfLoaded = true;
      fail(listBox, t("Couldn't load — check your connection and try again."));
    } finally {
      loading = false;
    }
  }

  root.appendChild(el);
  if (cls) void loadData();
  if (!RM()) {
    gsap.fromTo(".load-head", { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
    gsap.fromTo(".dash-hero", { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: "back.out(1.4)" });
    gsap.fromTo(".dash-col", { y: 30, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.08, duration: 0.35, ease: "back.out(1.5)", delay: 0.1 });
  }
  void fx;
  return () => {
    document.removeEventListener("keydown", onKey);
  };
});
