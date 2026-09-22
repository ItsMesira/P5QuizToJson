/* ============ P5 QUIZ — CLASSROOM (entry): join → sign in → dashboard ============ */
import gsap from "gsap";
import { registerScreen, go } from "./screens";
import { h, toast } from "./dom";
import { audio } from "../core/audio";
import { fx } from "../fx/particles";
import { RM } from "../fx/transitions";
import { ransomize } from "../fx/ransom";
import { scopedTimeout } from "../core/runtime";
import { cloud, cloudError, type ApiResult } from "../core/api";
import { t } from "../core/i18n";

type Mode = "root" | "join" | "make" | "auth" | "create";

/** friendly, localized error line for a failed API call */
function apiErrorText(r: ApiResult): string {
  if (r.status === 0) return t("Classroom server offline — try again later.");
  if (r.status === 404) return t("No class with that code.");
  if (r.status === 401) return t("Wrong username or password.");
  if (r.status === 429) return t("Too many attempts — wait a moment.");
  return cloudError(r);
}

registerScreen("entry", (root, scope) => {
  let mode: Mode = "root";
  let pendingClass: string | null = null; // code entered in the join step
  let pendingMake = false;
  let busy = false;

  const session = () => cloud.session;

  const el = h("div", { class: "screen entry-screen" }, [
    h("div", { id: "hud-top" }, [
      h("div", { class: "hud-tag" }, [t("CLASSROOM // P5 QUIZ")]),
      h("div", { class: "hud-tag alt" }, [t("★ STEAL TOGETHER")]),
    ]),
    h("div", { class: "entry-deco", "aria-hidden": "true" }, [
      h("span", { class: "entry-deco-word" }, [t("CLASSROOM")]),
      h("span", { class: "entry-deco-dots" }),
    ]),
    h("div", { class: "entry-wrap" }, [
      h("aside", { class: "entry-hero" }, [
        h("div", { id: "intro-eyebrow" }, [t("— TAKE YOUR SEAT —")]),
        h("h2", { class: "entry-title" }, [h("span", { class: "entry-ransom" })]),
        h("p", { class: "entry-lead" }, [t("Join a class first, then sign in. Or play solo.")]),
        h("div", { class: "entry-chip" }, []),
      ]),
      h("section", { class: "entry-panel" }, [
        h("div", { class: "entry-panel-head" }, [h("span", { class: "entry-panel-title" })]),
        h("div", { class: "entry-stage" }),
      ]),
    ]),
  ]);

  const stage = el.querySelector<HTMLElement>(".entry-stage")!;
  const panelTitle = el.querySelector<HTMLElement>(".entry-panel-title")!;
  const chipBox = el.querySelector<HTMLElement>(".entry-chip")!;

  const setPanelTitle = (label: string) => {
    panelTitle.textContent = "";
    ransomize(panelTitle, label, { size: "clamp(15px,1.5vw,20px)" });
  };

  const updateChip = () => {
    const s = session();
    chipBox.textContent = "";
    const dot = h("span", { class: `entry-chip-dot ${s ? "on" : ""}` });
    chipBox.append(
      dot,
      s
        ? t("Signed in as {name}", { name: s.user.username }) + (s.cls ? ` — ${s.cls.name}` : "")
        : t("NOT SIGNED IN"),
    );
  };

  /** inline error line under a form; returns show/hide helpers */
  const errorBox = () => h("div", { class: "entry-error hidden" }, []);
  const showError = (box: HTMLElement, msg: string) => {
    box.textContent = msg;
    box.classList.remove("hidden");
    audio.sfx("wrong");
    fx.shake(6);
  };
  const clearError = (box: HTMLElement) => {
    box.classList.add("hidden");
    box.textContent = "";
  };

  /* ---------- root: P5 menu rows ---------- */
  const row = (key: string, icon: string, label: string, sub: string, action: () => void, accent = false) => {
    const rowEl = h("button", { class: `entry-btn entry-row ${accent ? "accent" : ""}`, "data-key": key }, [
      h("span", { class: "er-key" }, [key]),
      h("span", { class: "er-icon" }, [icon]),
      h("span", { class: "er-text" }, [
        h("span", { class: "er-label" }),
        h("span", { class: "er-sub" }, [sub]),
      ]),
      h("span", { class: "er-arrow" }, ["◀"]),
    ]);
    ransomize(rowEl.querySelector<HTMLElement>(".er-label")!, label, { size: "clamp(19px,2.3vw,30px)" });
    rowEl.addEventListener("mouseenter", () => audio.sfx("hover"));
    rowEl.addEventListener("click", () => {
      if (busy) return;
      audio.sfx("select");
      action();
    });
    return rowEl;
  };

  let rootRows: HTMLElement[] = [];

  const renderRoot = () => {
    const s = session();
    const rows = [
      row("1", "🎓", t("JOIN A CLASS"), t("Use the code from your teacher"), () => { mode = "join"; render(); }, true),
      row("2", "★", t("MAKE A CLASS"), t("Start your own classroom"), () => { mode = "make"; render(); }),
      s
        ? row("3", "🗂", t("OPEN CLASSROOM"), t("Back to your class page"), () => void go({ name: "dashboard" }))
        : row("3", "🃏", t("PLAY AS GUEST"), t("Jump straight into the menu"), () => void go({ name: "title" })),
      s
        ? row("4", "✕", t("LOG OUT"), t("End this session"), async () => {
            busy = true;
            await cloud.logout().catch(() => undefined);
            cloud.setSession(null);
            busy = false;
            toast(t("Logged out"), "info");
            render();
          })
        : row("4", "🔑", t("LOG IN"), t("I already have an account"), () => { mode = "auth"; render(); }),
    ];
    rootRows = rows;
    stage.append(h("div", { class: "entry-rows" }, rows));
    if (!RM()) {
      gsap.fromTo(
        ".entry-row",
        { x: -50, opacity: 0 },
        { x: 0, opacity: 1, stagger: 0.07, duration: 0.45, ease: "back.out(1.4)", clearProps: "transform,opacity" },
      );
    }
  };

  /* ---------- shared bits ---------- */
  const field = (label: string, type: string, ph: string, autocomplete = "off") =>
    h("div", { class: "field-col entry-field" }, [
      h("span", { class: "field-label" }, [label]),
      h("input", { class: "fill-input", type, placeholder: ph, autocomplete, spellcheck: "false" }),
    ]);

  const actions = (...btns: HTMLElement[]) => h("div", { class: "entry-actions" }, btns);

  const lockWhile = async (btns: HTMLElement[], fn: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    btns.forEach((b) => ((b as HTMLButtonElement).disabled = true));
    try {
      await fn();
    } finally {
      busy = false;
      btns.forEach((b) => ((b as HTMLButtonElement).disabled = false));
    }
  };

  const back = () => {
    audio.sfx("click");
    mode = "root";
    render();
  };

  const render = () => {
    stage.textContent = "";
    const s = session();
    updateChip();

    if (mode === "root") {
      setPanelTitle(t("SELECT"));
      renderRoot();
      return;
    }

    if (mode === "join") {
      setPanelTitle(t("JOIN A CLASS"));
      const err = errorBox();
      const input = h("input", { class: "fill-input entry-code", placeholder: "ABC123", maxlength: "8", spellcheck: "false", autocomplete: "off" });
      const next = h("button", { class: "sticker-btn accent entry-next" }, [t("CONTINUE ▸")]);
      const backBtn = h("button", { class: "sticker-btn entry-back" }, [t("◀ BACK")]);
      stage.append(
        h("p", { class: "entry-sub" }, [t("Enter the 4-8 character code your teacher shared.")]),
        h("div", { class: "entry-form" }, [h("div", { class: "entry-field" }, [input]), err, actions(next, backBtn)]),
      );
      const code = input as HTMLInputElement;
      code.focus();
      const proceed = () => {
        const v = code.value.trim().toUpperCase();
        if (!/^[A-Z0-9]{4,8}$/.test(v)) {
          showError(err, t("Code is 4-8 letters/numbers."));
          return;
        }
        pendingClass = v;
        pendingMake = false;
        mode = "auth";
        render();
      };
      next.addEventListener("click", proceed);
      backBtn.addEventListener("click", back);
      code.addEventListener("input", () => clearError(err));
      code.addEventListener("keydown", (e) => { if (e.key === "Enter") proceed(); });
      if (!RM()) gsap.fromTo(".entry-stage > *", { y: 24, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.05, duration: 0.3, ease: "back.out(1.5)", clearProps: "transform,opacity" });
      return;
    }

    if (mode === "make") {
      setPanelTitle(t("MAKE A CLASS"));
      const err = errorBox();
      const input = h("input", { class: "fill-input", placeholder: t("Class name, e.g. 6A Physics"), maxlength: "60", spellcheck: "false" });
      const next = h("button", { class: "sticker-btn accent entry-next" }, [t("CONTINUE ▸")]);
      const backBtn = h("button", { class: "sticker-btn entry-back" }, [t("◀ BACK")]);
      stage.append(
        h("p", { class: "entry-sub" }, [t("Create a class and share its code with your students.")]),
        h("div", { class: "entry-form" }, [h("div", { class: "entry-field" }, [input]), err, actions(next, backBtn)]),
      );
      const name = input as HTMLInputElement;
      name.focus();
      const proceed = () => {
        const v = name.value.trim();
        if (v.length < 2) {
          showError(err, t("Give the class a name (2+ characters)."));
          return;
        }
        pendingClass = v;
        pendingMake = true;
        mode = s ? "create" : "auth";
        render();
      };
      next.addEventListener("click", proceed);
      backBtn.addEventListener("click", back);
      name.addEventListener("input", () => clearError(err));
      name.addEventListener("keydown", (e) => { if (e.key === "Enter") proceed(); });
      if (!RM()) gsap.fromTo(".entry-stage > *", { y: 24, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.05, duration: 0.3, ease: "back.out(1.5)", clearProps: "transform,opacity" });
      return;
    }

    if (mode === "create") {
      setPanelTitle(t("CONFIRM"));
      const err = errorBox();
      const create = h("button", { class: "sticker-btn accent entry-next" }, [t("CREATE CLASS ★")]);
      const backBtn = h("button", { class: "sticker-btn entry-back" }, [t("◀ BACK")]);
      stage.append(
        h("p", { class: "entry-sub" }, [t("Creating “{name}” as {user}…", { name: pendingClass ?? "", user: s?.user.username ?? "" })]),
        h("div", { class: "entry-form" }, [err, actions(create, backBtn)]),
      );
      create.addEventListener("click", () =>
        lockWhile([create, backBtn], async () => {
          const r = await cloud.createClass(pendingClass ?? "");
          if (r.ok) {
            audio.sfx("correct");
            fx.starBurst(window.innerWidth / 2, window.innerHeight / 2, { gold: true, n: 16 });
            toast(t("Class “{name}” created", { name: pendingClass ?? "" }), "info");
            void go({ name: "dashboard" });
          } else {
            showError(err, apiErrorText(r));
          }
        }),
      );
      backBtn.addEventListener("click", back);
      if (!RM()) gsap.fromTo(".entry-stage > *", { y: 24, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.05, duration: 0.3, ease: "back.out(1.5)", clearProps: "transform,opacity" });
      return;
    }

    /* ---------- auth (join-first) ---------- */
    setPanelTitle(t("SIGN IN"));
    const err = errorBox();
    const userField = field(t("USERNAME"), "text", "phantom_name");
    const passField = field(t("PASSWORD"), "password", t("8+ characters"), "current-password");
    const emailField = field(t("EMAIL (OPTIONAL)"), "email", "you@school.com");
    const signIn = h("button", { class: "sticker-btn accent entry-login" }, [t("SIGN IN")]);
    const register = h("button", { class: "sticker-btn entry-register" }, [t("CREATE ACCOUNT")]);
    const backBtn = h("button", { class: "sticker-btn entry-back" }, [t("◀ BACK")]);
    stage.append(
      h("p", { class: "entry-sub" }, [
        pendingMake
          ? t("Sign in or create an account, then your class will be created.")
          : t("Joining class {code} — sign in or create an account.", { code: pendingClass ?? "" }),
      ]),
      h("div", { class: "entry-form" }, [userField, emailField, passField, err, actions(signIn, register, backBtn)]),
    );
    const u = userField.querySelector<HTMLInputElement>("input")!;
    const e = emailField.querySelector<HTMLInputElement>("input")!;
    const p = passField.querySelector<HTMLInputElement>("input")!;
    u.focus();

    const attempt = (isRegister: boolean) =>
      lockWhile([signIn, register, backBtn], async () => {
        const username = u.value.trim();
        const password = p.value;
        if (username.length < 3 || password.length < 8) {
          showError(err, t("Username 3+ · password 8+ characters."));
          return;
        }
        const classCode = pendingMake ? undefined : (pendingClass ?? undefined);
        const r = isRegister
          ? await cloud.register(username, password, e.value.trim(), classCode)
          : await cloud.login(username, password, classCode);
        if (r.ok) {
          if (pendingMake && !classCode) {
            const created = await cloud.createClass(pendingClass ?? "");
            if (created.ok) toast(t("Class “{name}” created", { name: pendingClass ?? "" }), "info");
          }
          audio.sfx("correct");
          toast(t("Welcome, {name}", { name: cloud.session?.user.username ?? "" }), "info");
          void go({ name: "dashboard" });
          return;
        }
        showError(err, apiErrorText(r));
        if (r.status === 404) {
          mode = "join";
          scopedTimeout(() => render(), 900, scope);
        }
      });

    signIn.addEventListener("click", () => void attempt(false));
    register.addEventListener("click", () => void attempt(true));
    backBtn.addEventListener("click", back);
    [u, e, p].forEach((inp) => inp.addEventListener("input", () => clearError(err)));
    p.addEventListener("keydown", (ev) => { if (ev.key === "Enter") void attempt(false); });
    if (!RM()) gsap.fromTo(".entry-stage > *", { y: 24, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.05, duration: 0.3, ease: "back.out(1.5)", clearProps: "transform,opacity" });
  };

  /* ESC: sub-stages step back to root, root escapes to the main menu */
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (mode !== "root") back();
      else void go({ name: "title" });
      return;
    }
    if (mode === "root" && e.key >= "1" && e.key <= "4") {
      rootRows[Number(e.key) - 1]?.click();
    }
  };
  window.addEventListener("keydown", onKey);

  ransomize(el.querySelector<HTMLElement>(".entry-ransom")!, t("CLASSROOM"), { size: "clamp(38px,5.2vw,76px)" });

  root.appendChild(el);
  render();

  // root back-to-menu is rendered by the panel head for consistency
  el.querySelector(".entry-panel-head")!.appendChild(
    h("button", { class: "entry-back-menu sticker-btn" }, [t("◀ BACK TO MENU")]),
  );
  el.querySelector(".entry-back-menu")!.addEventListener("click", () => {
    audio.sfx("click");
    void go({ name: "title" });
  });

  if (!RM()) {
    gsap.fromTo("#hud-top .hud-tag", { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.08, ease: "power3.out", clearProps: "transform,opacity" });
    gsap.fromTo(".entry-hero > *", { x: -40, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.06, duration: 0.4, ease: "power3.out", clearProps: "transform,opacity" });
    gsap.fromTo(".entry-panel", { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, delay: 0.15, ease: "back.out(1.3)", clearProps: "transform,opacity" });
  }

  return () => window.removeEventListener("keydown", onKey);
});
