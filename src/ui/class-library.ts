/* ============ P5 QUIZ — CLASS LIBRARY ============ */
/* The class's shared quiz shelf: server-paged, searchable and sortable, with
   teacher-only pin / delete / bulk select. The cards reuse the shared `.qcard`
   markup (components.css); this screen only owns layout classes. */
import gsap from "gsap";
import { registerScreen, go, startQuiz } from "./screens";
import { h, toast } from "./dom";
import { audio } from "../core/audio";
import { RM } from "../fx/transitions";
import { cloud, cloudError, type QuizListRow } from "../core/api";
import { validateQuiz } from "../core/validator";
import { saveQuiz } from "../core/store";
import { scopedTimeout } from "../core/runtime";
import { t } from "../core/i18n";
import "../styles/class-library.css";

type Sort = "newest" | "title" | "played";

const LIMIT = 24;

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso ?? "") : d.toLocaleDateString();
}

registerScreen("class-library", (root, scope) => {
  const session = cloud.session;
  if (!session?.cls) {
    void go({ name: "entry" }, { instant: true });
    return () => undefined;
  }
  const cls = session.cls;
  const isTeacher = cls.role === "teacher";

  let sort: Sort = "newest";
  let query = "";
  let page = 1;
  let total = 0;
  let pages = 1;
  let ticket = 0;
  let selectMode = false;
  let debounce: number | null = null;
  const selected = new Set<string>();

  const countEl = h("span", { class: "clib-count" }, [t("…")]);
  const searchEl = h("input", {
    class: "clib-search",
    type: "search",
    placeholder: t("Search quizzes…"),
    "aria-label": t("Search quizzes"),
    spellcheck: "false",
  });
  const sortsEl = h("div", { class: "clib-sorts" }, [
    h("button", { class: "clib-sort active", type: "button", "data-sort": "newest" }, [t("NEWEST")]),
    h("button", { class: "clib-sort", type: "button", "data-sort": "title" }, [t("A–Z")]),
    h("button", { class: "clib-sort", type: "button", "data-sort": "played" }, [t("MOST PLAYED")]),
  ]);
  const bulkCount = h("span", { class: "clib-bulk-count" }, [t("{n} selected", { n: 0 })]);
  const bulkDel = h("button", { class: "clib-bulk-del", type: "button" }, [t("DELETE SELECTED")]);
  bulkDel.disabled = true;
  const bulk = h("div", { class: "clib-bulk hidden" }, [bulkCount, bulkDel]);
  const selectToggle = h("button", { class: "clib-select-toggle", type: "button" }, [t("SELECT")]);
  const grid = h("div", { class: "clib-grid" });
  const pager = h("div", { class: "clib-pager" });

  const el = h("div", { class: "screen class-library-screen" }, [
    h("header", { class: "load-head" }, [
      h("button", { class: "back-btn", "aria-label": t("Back") }, ["◀"]),
      h("h2", { class: "screen-title" }, [t("CLASS LIBRARY")]),
      h("div", { class: "head-spacer" }, []),
    ]),
    h("div", { class: "clib-body" }, [
      h("div", { class: "clib-sub" }, [cls.name, countEl]),
      h("div", { class: "clib-toolbar" }, [searchEl, sortsEl, isTeacher ? selectToggle : null]),
      isTeacher ? bulk : null,
      grid,
      pager,
    ]),
  ]);
  root.appendChild(el);

  /* ---- nav ---- */
  const back = el.querySelector<HTMLElement>(".back-btn")!;
  back.addEventListener("click", () => void go({ name: "dashboard" }));
  back.addEventListener("mouseenter", () => audio.sfx("hover"));

  /* ---- selection (teacher only) ---- */
  const cardsIn = () => [...grid.querySelectorAll<HTMLElement>(".qcard")];

  function updateBulk() {
    bulkCount.textContent = t("{n} selected", { n: selected.size });
    bulkDel.disabled = selected.size === 0;
  }

  function syncCard(cardNode: HTMLElement) {
    if (selectMode) {
      cardNode.setAttribute("role", "checkbox");
      cardNode.tabIndex = 0;
      cardNode.setAttribute("aria-checked", cardNode.classList.contains("selected") ? "true" : "false");
    } else {
      cardNode.removeAttribute("role");
      cardNode.removeAttribute("tabindex");
      cardNode.removeAttribute("aria-checked");
    }
  }

  function toggleSelected(cardNode: HTMLElement, id: string) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    cardNode.classList.toggle("selected", selected.has(id));
    cardNode.setAttribute("aria-checked", selected.has(id) ? "true" : "false");
    audio.sfx("select");
    updateBulk();
  }

  selectToggle.addEventListener("click", () => {
    audio.sfx("select");
    selectMode = !selectMode;
    selectToggle.classList.toggle("active", selectMode);
    bulk.classList.toggle("hidden", !selectMode);
    if (!selectMode) selected.clear();
    updateBulk();
    cardsIn().forEach((c) => {
      if (!selectMode) c.classList.remove("selected");
      syncCard(c);
    });
  });

  /* ---- card ---- */
  function buildCard(row: QuizListRow): HTMLElement {
    const playBtn = h("button", { class: "lib-btn play qcard-play", type: "button" }, [t("▶ PLAY")]);
    const pinBtn = isTeacher
      ? h(
          "button",
          { class: "lib-btn qcard-pin", type: "button", "aria-pressed": row.pinned ? "true" : "false" },
          [row.pinned ? t("PINNED") : t("📌 PIN")],
        )
      : null;
    const delBtn = isTeacher
      ? h("button", { class: "lib-btn danger qcard-del", type: "button", "aria-label": t("Remove from class") }, ["✕"])
      : null;
    const isSel = selected.has(row.id);

    const cardNode = h(
      "div",
      {
        class: `qcard${row.pinned ? " pinned" : ""}${isSel ? " selected" : ""}`,
        "data-qid": row.id,
        role: selectMode ? "checkbox" : undefined,
        tabindex: selectMode ? "0" : undefined,
        "aria-checked": selectMode ? String(isSel) : undefined,
      },
      [
        h("div", { class: "qcard-title" }, [row.title]),
        h("div", { class: "qcard-meta" }, [`${t("by {author}", { author: row.author })} · ${fmtDay(row.created)} · ▶ ${row.plays}`]),
        h("div", { class: "qcard-actions" }, [playBtn, pinBtn, delBtn]),
      ],
    );

    playBtn.addEventListener("click", () => void playRow(row, playBtn));
    pinBtn?.addEventListener("click", () => void pinRow(row, cardNode, pinBtn));
    delBtn?.addEventListener("click", () => void removeRow(row, cardNode));
    cardNode.addEventListener("click", (e) => {
      if (!selectMode) return;
      if ((e.target as Element).closest("button")) return;
      toggleSelected(cardNode, row.id);
    });
    cardNode.addEventListener("keydown", (e) => {
      if (!selectMode) return;
      const ev = e as KeyboardEvent;
      if (ev.key !== " " && ev.key !== "Enter") return;
      if ((e.target as Element).closest("button")) return;
      ev.preventDefault();
      toggleSelected(cardNode, row.id);
    });
    return cardNode;
  }

  async function playRow(row: QuizListRow, btn: HTMLButtonElement) {
    audio.sfx("select");
    btn.disabled = true;
    try {
      const r = await cloud.fetchQuiz(cls.id, row.id);
      if (!scope.alive()) return;
      if (r.ok && r.data.quiz) {
        const v = validateQuiz(r.data.quiz);
        if (v.ok) {
          saveQuiz(v.quiz, `class:${cls.name}`);
          await startQuiz({ ...v.quiz, source: `class:${cls.name}`, quizId: row.id });
        } else {
          toast(t("That quiz is broken"), "error");
        }
      } else {
        toast(cloudError(r), "error");
      }
    } finally {
      btn.disabled = false;
    }
  }

  const busyUntil = new Map<string, number>();
  const busy = (id: string, kind: "pin" | "del") => (busyUntil.get(`${id}:${kind}`) ?? 0) > Date.now();

  async function pinRow(row: QuizListRow, cardNode: HTMLElement, btn: HTMLButtonElement) {
    if (busy(row.id, "pin")) return;
    busyUntil.set(`${row.id}:pin`, Date.now() + 500);
    const next = !row.pinned;
    btn.disabled = true;
    const r = await cloud.pinQuiz(cls.id, row.id, next);
    btn.disabled = false;
    if (!scope.alive()) return;
    if (!r.ok) {
      toast(cloudError(r), "error");
      return;
    }
    row.pinned = next;
    cardNode.classList.toggle("pinned", next);
    btn.setAttribute("aria-pressed", String(next));
    btn.textContent = next ? t("PINNED") : t("📌 PIN");
  }

  async function removeRow(row: QuizListRow, cardNode: HTMLElement) {
    if (busy(row.id, "del")) return;
    busyUntil.set(`${row.id}:del`, Date.now() + 500);
    const r = await cloud.deleteQuiz(cls.id, row.id);
    if (!scope.alive()) return;
    if (!r.ok) {
      toast(cloudError(r), "error");
      return;
    }
    audio.sfx("paper");
    selected.delete(row.id);
    updateBulk();
    cardNode.remove();
    total = Math.max(0, total - 1);
    pages = Math.max(1, Math.ceil(total / LIMIT));
    if (page > pages) page = pages;
    countEl.textContent = t("{n} quizzes", { n: total });
    if (!grid.querySelector(".qcard")) void fetchPage();
    else renderPager();
  }

  async function bulkDelete() {
    const ids = [...selected];
    if (!ids.length) return;
    bulkDel.disabled = true;
    let okN = 0;
    for (const id of ids) {
      const r = await cloud.deleteQuiz(cls.id, id);
      if (!scope.alive()) return;
      if (r.ok) {
        okN++;
        selected.delete(id);
      }
    }
    const failN = ids.length - okN;
    if (okN) toast(t("Deleted {n} quizzes", { n: okN }), "info");
    if (failN) toast(t("Couldn't delete {n} quizzes", { n: failN }), "error");
    updateBulk();
    await fetchPage();
  }
  bulkDel.addEventListener("click", () => void bulkDelete());

  /* ---- render ---- */
  function showMsg(text: string) {
    grid.textContent = "";
    grid.appendChild(h("p", { class: "clib-msg" }, [text]));
  }

  function renderCards(rows: QuizListRow[]) {
    grid.textContent = "";
    if (!rows.length) {
      showMsg(query.trim() ? t("No quizzes match “{q}”", { q: query.trim() }) : t("No quizzes here yet."));
      return;
    }
    rows.forEach((row) => grid.appendChild(buildCard(row)));
    if (!RM()) {
      gsap.fromTo(grid.querySelectorAll(".qcard"), { y: 20, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.03, duration: 0.28, ease: "back.out(1.5)", clearProps: "transform,opacity" });
    }
  }

  function renderPager() {
    pager.textContent = "";
    if (total <= 0) return;
    const start = (page - 1) * LIMIT + 1;
    const end = Math.min(page * LIMIT, total);
    const prev = h("button", { class: "clib-prev", type: "button", "aria-label": t("Previous") }, ["◀"]);
    const next = h("button", { class: "clib-next", type: "button", "aria-label": t("Next") }, ["▶"]);
    prev.disabled = page <= 1;
    next.disabled = page >= pages;
    prev.addEventListener("click", () => {
      page--;
      void fetchPage();
    });
    next.addEventListener("click", () => {
      page++;
      void fetchPage();
    });
    pager.append(
      h("span", { class: "clib-showing" }, [t("Showing {a}–{b} of {n}", { a: start, b: end, n: total })]),
      prev,
      h("span", { class: "clib-pos" }, [`${page}/${pages}`]),
      next,
    );
  }

  /* A ticket makes the newest request the only writer: a slow response for an
     older query can never paint over a newer one. */
  async function fetchPage() {
    const tk = ++ticket;
    showMsg(t("Loading…"));
    pager.textContent = "";
    const r = await cloud.listQuizzes(cls.id, {
      q: query.trim() || undefined,
      sort,
      page,
      limit: LIMIT,
    });
    if (tk !== ticket || !scope.alive()) return;
    if (!r.ok) {
      showMsg(cloudError(r));
      return;
    }
    const rows = r.data.quizzes ?? [];
    total = typeof r.data.total === "number" ? r.data.total : rows.length;
    const reportedPages = typeof r.data.pages === "number" ? r.data.pages : Math.ceil(total / LIMIT);
    pages = Math.max(1, reportedPages || 1);
    if (typeof r.data.page === "number") page = r.data.page;
    const clampedPage = Math.min(Math.max(1, page), pages);
    if (clampedPage !== page) {
      page = clampedPage;
      void fetchPage();
      return;
    }
    page = clampedPage;
    countEl.textContent = t("{n} quizzes", { n: total });
    renderCards(rows);
    renderPager();
  }

  /* ---- toolbar ---- */
  searchEl.addEventListener("input", () => {
    query = searchEl.value;
    if (debounce !== null) window.clearTimeout(debounce);
    debounce = scopedTimeout(() => {
      debounce = null;
      page = 1;
      void fetchPage();
    }, 250, scope);
  });

  const sortChips = [...el.querySelectorAll<HTMLElement>(".clib-sort")];
  sortChips.forEach((chip) => {
    chip.addEventListener("mouseenter", () => audio.sfx("hover"));
    chip.addEventListener("click", () => {
      const next = (chip.getAttribute("data-sort") ?? "newest") as Sort;
      if (next === sort) return;
      audio.sfx("select");
      sort = next;
      page = 1;
      sortChips.forEach((c) => c.classList.toggle("active", c === chip));
      void fetchPage();
    });
  });

  if (!RM()) {
    gsap.fromTo(el.querySelector(".load-head")!, { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out", clearProps: "transform,opacity" });
    gsap.fromTo(el.querySelector(".clib-toolbar")!, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: "back.out(1.5)", clearProps: "transform,opacity" });
  }
  void fetchPage();

  return () => {
    if (debounce !== null) window.clearTimeout(debounce);
  };
});
