/* ============ P5 QUIZ — ADMIN PANEL (lazy chunk) ============ */
/* Server-authorized only: every action hits /api/admin, which requires the
   p5q_admin session + CSRF + step-up for destructive ops. The URL is not the
   gate. All DOM is built with h() (textContent) — CSP-safe. */
import { registerScreen, go } from "./screens";
import { h, clear } from "./dom";
import { t } from "../core/i18n";
import { audio } from "../core/audio";
import "../styles/admin.css";

interface ApiResp {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}

async function adminReq(action: string, payload: Record<string, unknown> = {}): Promise<ApiResp> {
  const csrf = document.cookie.split("; ").find((c) => c.startsWith("p5q_csrf="))?.slice(9) ?? "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (csrf) headers["x-csrf-token"] = csrf;
  try {
    const res = await fetch("/api/admin", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: JSON.stringify({ action, ...payload }),
    });
    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      /* empty */
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: t("Cannot reach the server") } };
  }
}

const err = (r: ApiResp): string => String(r.data.error ?? `HTTP ${r.status}`);

registerScreen("admin", (root) => {
  const el = h("div", { class: "screen admin-screen" }, [
    h("div", { class: "admin-body" }, []),
  ]);
  root.appendChild(el);
  const body = () => el.querySelector<HTMLElement>(".admin-body")!;

  let impersonating = false;

  /* ---------- small UI helpers ---------- */
  const card = (cls = "") => h("div", { class: `admin-card ${cls}` }, []);
  const row = (children: (Node | string | null)[]) => h("div", { class: "admin-row" }, children);
  const btn = (label: string, fn: () => void, cls = "") => {
    const b = h("button", { class: `sticker-btn ${cls}` }, [label]);
    b.addEventListener("mouseenter", () => audio.sfx("hover"));
    b.addEventListener("click", () => {
      audio.sfx("select");
      fn();
    });
    return b;
  };

  const modal = h("div", { class: "admin-modal hidden" }, []);
  el.appendChild(modal);
  const promptPassword = (title: string): Promise<string | null> =>
    new Promise((resolve) => {
      clear(modal);
      modal.classList.remove("hidden");
      const input = h("input", { type: "password", autocomplete: "current-password" });
      const close = (val: string | null) => {
        modal.classList.add("hidden");
        clear(modal);
        resolve(val);
      };
      const c = card();
      c.append(
        h("h3", {}, [title]),
        h("div", { class: "admin-field" }, [input]),
        h("div", { class: "admin-tabs" }, [
          btn(t("CONFIRM"), () => close(input.value || null), "accent"),
          btn(t("CANCEL"), () => close(null)),
        ]),
      );
      modal.appendChild(c);
      input.focus();
      input.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key === "Enter") close(input.value || null);
      });
    });

  const notify = (msg: string) => {
    const n = h("div", { class: "admin-note admin-notice" }, [msg]);
    body().prepend(n);
    window.setTimeout(() => n.remove(), 4000);
  };

  const askConfirm = (title: string): Promise<boolean> =>
    new Promise((resolve) => {
      clear(modal);
      modal.classList.remove("hidden");
      const done = (v: boolean) => {
        modal.classList.add("hidden");
        clear(modal);
        resolve(v);
      };
      const c = card();
      c.append(
        h("h3", {}, [title]),
        h("div", { class: "admin-tabs" }, [
          btn(t("CONFIRM"), () => done(true), "accent"),
          btn(t("CANCEL"), () => done(false)),
        ]),
      );
      modal.appendChild(c);
    });

  const showSecret = (title: string, secret: string) =>
    new Promise<void>((resolve) => {
      clear(modal);
      modal.classList.remove("hidden");
      const done = () => {
        modal.classList.add("hidden");
        clear(modal);
        resolve();
      };
      const c = card();
      c.append(
        h("h3", {}, [title]),
        h("div", { class: "admin-note" }, [secret]),
        h("div", { class: "admin-tabs" }, [btn(t("DONE"), done, "accent")]),
      );
      modal.appendChild(c);
    });

  /* run an action; on the step-up 403, prompt for the password and retry once */
  const guarded = async (action: string, payload: Record<string, unknown> = {}): Promise<ApiResp> => {
    let r = await adminReq(action, payload);
    if (!r.ok && r.status === 403 && /re-enter/i.test(err(r))) {
      const pw = await promptPassword(t("Confirm your password"));
      if (!pw) return r;
      const s = await adminReq("stepUp", { password: pw });
      if (!s.ok) {
        notify(err(s));
        return r;
      }
      r = await adminReq(action, payload);
    }
    if (!r.ok) notify(err(r));
    return r;
  };

  /* ---------- auth screens ---------- */
  const renderLogin = () => {
    body().replaceChildren();
    const c = card();
    const user = h("input", { type: "text", autocomplete: "username", placeholder: t("admin") });
    const pass = h("input", { type: "password", autocomplete: "current-password", placeholder: t("password") });
    const submit = async () => {
      const r = await adminReq("login", { username: user.value, password: pass.value });
      if (!r.ok) {
        notify(err(r));
        return;
      }
      void boot();
    };
    c.append(
      h("h3", {}, [t("ADMIN LOGIN")]),
      h("div", { class: "admin-field" }, [user]),
      h("div", { class: "admin-field" }, [pass]),
      h("div", { class: "admin-tabs" }, [btn(t("SIGN IN"), submit, "accent")]),
      h("div", { class: "admin-note" }, [t("Authorized personnel only. All actions are logged.")]),
    );
    pass.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") void submit();
    });
    body().appendChild(c);
  };

  const changePwFlow = async () => {
    const cur = await promptPassword(t("Current password"));
    if (!cur) return;
    const next = await promptPassword(t("New password (8+ chars)"));
    if (!next) return;
    const r = await adminReq("changePassword", { current: cur, next });
    notify(r.ok ? t("Password changed") : err(r));
  };

  /* ---------- tabs ---------- */
  const TABS = ["Users", "Classes", "Quizzes", "Results", "Sessions", "Audit", "System"] as const;
  let active: (typeof TABS)[number] = "Users";

  const renderImpersonationBanner = async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      const j = (await res.json()) as { session?: { user?: { impersonated?: boolean; username?: string } } };
      impersonating = !!j.session?.user?.impersonated;
      if (!impersonating) return;
      const b = h("div", { class: "admin-impersonation-banner" }, [
        h("span", {}, [t("Impersonating {name} — you are not yourself", { name: j.session?.user?.username ?? "" })]),
        btn(t("STOP"), async () => {
          const r = await guarded("impersonate.stop");
          if (r.ok) location.reload();
        }),
      ]);
      el.prepend(b);
    } catch {
      /* ignore */
    }
  };

  const renderPanel = async () => {
    body().replaceChildren();
    const identity = await adminReq("me");
    const who = identity.ok ? String((identity.data.admin as { username?: string })?.username ?? "") : "";

    const head = h("div", { class: "admin-head" }, [
      h("h2", { class: "screen-title" }, [t("ADMIN PANEL")]),
      h("span", { class: "admin-note" }, [who ? `@${who}` : ""]),
      h("span", { class: "spacer" }, []),
      btn(t("↻ REFRESH"), () => void renderTab(active)),
      btn(t("CHANGE PW"), () => void changePwFlow()),
      btn(t("⤶ SIGN OUT"), async () => {
        await adminReq("logout");
        location.href = "/";
      }),
      btn(t("⌂ HOME"), () => void go({ name: "title" })),
    ]);
    const tabs = h("div", { class: "admin-tabs" }, []);
    TABS.forEach((name) =>
      tabs.appendChild(
        btn(t(name), () => {
          active = name;
          [...tabs.children].forEach((c, i) => c.classList.toggle("active", TABS[i] === name));
          void renderTab(name);
        }, name === active ? "active" : ""),
      ),
    );
    const content = card();
    content.classList.add("admin-content");
    body().append(head, tabs, content);
    await renderTab(active);
  };

  const renderTab = async (name: (typeof TABS)[number]) => {
    const content = body().querySelector<HTMLElement>(".admin-content");
    if (!content) return;
    clear(content);
    content.appendChild(h("div", { class: "admin-note" }, [t("Loading…")]));
    let c: HTMLElement;
    try {
      if (name === "Users") c = await tabUsers();
      else if (name === "Classes") c = await tabClasses();
      else if (name === "Quizzes") c = await tabList("quizzes.list", "quizzes", "Quizzes");
      else if (name === "Results") c = await tabList("results.list", "results", "Results");
      else if (name === "Sessions") c = await tabList("sessions.list", "sessions", "Sessions");
      else if (name === "Audit") c = await tabList("audit.list", "audit", "Audit");
      else c = await tabSystem();
    } catch (e) {
      c = cardWith(String((e as Error)?.message ?? e));
    }
    clear(content);
    // NOTE: keep the .admin-content class on `content` — it is the anchor that
    // every later renderTab call looks up (removing it bricked the panel).
    while (c.firstChild) content.appendChild(c.firstChild);
  };

  const listCard = (title: string, items: Record<string, unknown>[], render: (it: Record<string, unknown>) => Node) => {
    const c = card();
    c.appendChild(h("h3", {}, [t(title)]));
    if (!items.length) c.appendChild(h("div", { class: "admin-note" }, [t("Nothing here.")]));
    items.forEach((it) => c.appendChild(render(it)));
    return c;
  };

  /* perform an action once, reflect it optimistically, and do NOT refetch the
     tab afterwards — the second list request was what made every action feel
     slow. On success the optimistic change stands (and the row is removed for
     deletes); on failure the tab is re-rendered from the server so the UI never
     lies. A step-up is the only case that legitimately adds a request. */
  const runAction = async (
    action: string,
    payload: Record<string, unknown>,
    opts: { confirm?: string; success?: string; removeRow?: HTMLElement; onOk?: () => void } = {},
  ): Promise<boolean> => {
    if (opts.confirm && !(await askConfirm(opts.confirm))) return false;
    opts.removeRow?.remove();
    const r = await guarded(action, payload);
    if (r.ok) {
      opts.onOk?.();
      if (opts.success) notify(opts.success);
      return true;
    }
    await renderTab(active);
    return false;
  };

  const userLine = (u: Record<string, unknown>) =>
    `${u.username}${u.is_admin ? "  ★admin" : ""}  ·  ${u.email ?? "—"}  ·  ${u.classes} classes`;

  const tabUsers = async () => {
    const r = await adminReq("users.list", { limit: 100 });
    if (!r.ok) return cardWith(err(r));
    const users = (r.data.users as Record<string, unknown>[]) ?? [];
    return listCard("Users", users, (u) => {
      const id = String(u.id);
      let adminNow = !!u.is_admin;
      const label = h("span", { class: "grow" }, [userLine(u)]);
      const promoteBtn = btn(t(adminNow ? "Demote" : "Promote"), () => {
        const next = !adminNow;
        void runAction("users.setAdmin", { id, isAdmin: next }, {
          success: next ? t("Admin access granted") : t("Admin access revoked"),
          onOk: () => {
            adminNow = next;
            promoteBtn.textContent = t(adminNow ? "Demote" : "Promote");
            label.textContent = userLine({ ...u, is_admin: adminNow });
          },
        });
      });
      const rowEl = row([
        label,
        btn(t("Reset pw"), async () => {
          const res = await guarded("users.resetPassword", { id });
          if (res.ok) await showSecret(t("Temporary password"), String(res.data.temporaryPassword ?? ""));
        }),
        btn(t("Revoke"), () => void runAction("users.revokeSessions", { id }, { success: t("Sessions revoked") })),
        promoteBtn,
        btn(t("Impersonate"), async () => {
          const res = await guarded("impersonate.start", { userId: id });
          if (res.ok) location.href = "/";
        }),
        btn(t("Delete"), () =>
          void runAction("users.delete", { id }, {
            confirm: t("Delete {name}? This cascades their quizzes and results.", { name: String(u.username) }),
            success: t("User deleted"),
            removeRow: rowEl,
          }), "accent"),
      ]);
      return rowEl;
    });
  };

  const tabClasses = async () => {
    const r = await adminReq("classes.list", { limit: 100 });
    if (!r.ok) return cardWith(err(r));
    const classes = (r.data.classes as Record<string, unknown>[]) ?? [];
    return listCard("Classes", classes, (c) => {
      const id = String(c.id);
      const rowEl = row([
        h("span", { class: "grow" }, [`${c.name}  ·  code ${c.code}  ·  owner ${c.owner}  ·  ${c.members} members  ·  ${c.quizzes} quizzes`]),
        btn(t("Clear results"), () =>
          void runAction("results.clear", { classId: id }, {
            confirm: t("Clear all results posted to {name}?", { name: String(c.name) }),
            success: t("Class results cleared"),
          })),
        btn(t("Delete"), () =>
          void runAction("classes.delete", { id }, {
            confirm: t("Delete class {name}? This removes its quizzes and results.", { name: String(c.name) }),
            success: t("Class deleted"),
            removeRow: rowEl,
          }), "accent"),
      ]);
      return rowEl;
    });
  };

  const tabList = async (action: string, key: string, title: string) => {
    const r = await adminReq(action, { limit: 100 });
    if (!r.ok) return cardWith(err(r));
    const items = (r.data[key] as Record<string, unknown>[]) ?? [];
    return listCard(title, items, (it) => {
      const summary = Object.entries(it)
        .filter(([k]) => k !== "id")
        .map(([k, v]) => `${k}: ${v === null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}`)
        .join("  ·  ");
      const rowEl = row([h("span", { class: "grow" }, [summary])]);
      if (key === "quizzes") rowEl.appendChild(btn(t("Delete"), () => void runAction("quizzes.delete", { id: String(it.id) }, { confirm: t("Delete this quiz?"), success: t("Quiz deleted"), removeRow: rowEl }), "accent"));
      if (key === "results") rowEl.appendChild(btn(t("Delete"), () => void runAction("results.delete", { id: String(it.id) }, { confirm: t("Delete this result?"), success: t("Result deleted"), removeRow: rowEl }), "accent"));
      if (key === "sessions") rowEl.appendChild(btn(t("Revoke user"), () => void runAction("sessions.revoke", { userId: String(it.user_id ?? "") }, { success: t("Sessions revoked") })));
      return rowEl;
    });
  };

  const tabSystem = async () => {
    const r = await adminReq("stats");
    if (!r.ok) return cardWith(err(r));
    const s = (r.data.stats as Record<string, unknown>) ?? {};
    const c = card();
    c.appendChild(h("h3", {}, [t("System")]));
    Object.entries(s).forEach(([k, v]) => c.appendChild(row([h("span", { class: "grow" }, [`${k}: ${String(v)}`])])));
    return c;
  };

  const cardWith = (message: string) => {
    const c = card();
    c.appendChild(h("div", { class: "admin-note" }, [message]));
    return c;
  };

  const boot = async () => {
    const me = await adminReq("me");
    if (me.ok) {
      await renderImpersonationBanner();
      await renderPanel();
    } else {
      renderLogin();
    }
  };

  void boot();
  return () => {
    /* nothing to clean up (listeners are scoped to removed nodes) */
  };
});