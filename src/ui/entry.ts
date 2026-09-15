/* ============ P5 QUIZ — ENTRY SCREEN (join class → login/register → classroom) ============ */
import gsap from "gsap";
import { registerScreen, go } from "./screens";
import { h, toast } from "./dom";
import { audio } from "../core/audio";
import { fx } from "../fx/particles";
import { RM } from "../fx/transitions";
import { ransomize } from "../fx/ransom";
import { cloud, cloudError } from "../core/api";

type Mode = "root" | "join" | "make" | "auth" | "create";

registerScreen("entry", (root) => {
  let mode: Mode = "root";
  let pendingClass: string | null = null; // code entered in the join step
  let pendingMake = false;

  const el = h("div", { class: "screen entry-screen" }, [
    h("div", { id: "hud-top" }, [
      h("div", { class: "hud-tag" }, ["CLASSROOM // P5 QUIZ"]),
      h("div", { class: "hud-tag alt" }, ["★ STEAL TOGETHER"]),
    ]),
    h("div", { class: "entry-stage" }),
  ]);

  const stage = el.querySelector<HTMLElement>(".entry-stage")!;

  const bigBtn = (label: string, icon: string, action: () => void, accent = false) => {
    const btn = h("button", { class: `entry-btn ${accent ? "accent" : ""}` }, [
      h("span", { class: "entry-icon" }, [icon]),
      h("span", { class: "entry-label" }),
    ]);
    ransomize(btn.querySelector<HTMLElement>(".entry-label")!, label, { size: "clamp(20px,2.6vw,32px)" });
    btn.addEventListener("mouseenter", () => audio.sfx("hover"));
    btn.addEventListener("click", () => {
      audio.sfx("select");
      action();
    });
    return btn;
  };

  const field = (label: string, type: string, ph: string) =>
    h("div", { class: "field-col entry-field" }, [
      h("span", { class: "field-label" }, [label]),
      h("input", { class: "fill-input", type, placeholder: ph, autocomplete: type === "password" ? "current-password" : "off", spellcheck: "false" }),
    ]);

  const back = () => {
    audio.sfx("click");
    mode = "root";
    render();
  };

  const render = () => {
    stage.textContent = "";
    const session = cloud.session;

    if (mode === "root") {
      stage.append(
        h("h2", { class: "entry-title" }, [h("span", { class: "entry-ransom" })]),
        h("p", { class: "entry-sub" }, [
          session
            ? `Signed in as ${session.user.username}${session.cls ? ` — class ${session.cls.name}` : ""}`
            : "Join a class first, then sign in. Or play solo.",
        ]),
      );
      const title = stage.querySelector<HTMLElement>(".entry-ransom")!;
      ransomize(title, "CLASSROOM", { size: "clamp(40px,7vw,96px)" });
      const buttons = h("div", { class: "entry-buttons" }, [
        bigBtn("JOIN A CLASS", "🎓", () => { mode = "join"; render(); }, true),
        bigBtn("MAKE A CLASS", "★", () => { mode = "make"; render(); }),
        session
          ? bigBtn("OPEN CLASSROOM", "🗂", () => void go({ name: "dashboard" }))
          : bigBtn("PLAY AS GUEST", "🃏", () => void go({ name: "title" })),
        session
          ? bigBtn("LOG OUT", "✕", async () => {
              await cloud.logout().catch(() => undefined);
              toast("Logged out", "info");
              render();
            })
          : bigBtn("LOG IN", "🔑", () => { mode = "auth"; render(); }),
      ]);
      stage.append(buttons);
      if (!RM()) gsap.fromTo(".entry-btn", { x: -60, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.08, duration: 0.5, ease: "back.out(1.4)" });
      return;
    }

    if (mode === "join") {
      stage.append(
        h("h3", { class: "entry-mode-title" }, [h("span", { class: "entry-ransom" })]),
        h("p", { class: "entry-sub" }, ["Enter the 6-character code your teacher shared."]),
      );
      ransomize(stage.querySelector<HTMLElement>(".entry-ransom")!, "JOIN A CLASS", { size: "clamp(26px,3.6vw,46px)" });
      const input = h("input", { class: "fill-input entry-code", placeholder: "ABC123", maxlength: "8", spellcheck: "false", autocomplete: "off" });
      stage.append(
        h("div", { class: "entry-field" }, [input]),
        h("div", { class: "entry-actions" }, [
          h("button", { class: "sticker-btn accent entry-next" }, ["CONTINUE ▸"]),
          h("button", { class: "sticker-btn entry-back" }, ["◀ BACK"]),
        ]),
      );
      const code = input as HTMLInputElement;
      code.focus();
      const proceed = () => {
        const v = code.value.trim().toUpperCase();
        if (!/^[A-Z0-9]{4,8}$/.test(v)) {
          toast("Code is 4-8 letters/numbers", "error");
          fx.shake(6);
          return;
        }
        pendingClass = v;
        pendingMake = false;
        mode = "auth";
        render();
      };
      stage.querySelector(".entry-next")!.addEventListener("click", proceed);
      stage.querySelector(".entry-back")!.addEventListener("click", back);
      code.addEventListener("keydown", (e) => { if (e.key === "Enter") proceed(); });
      if (!RM()) gsap.fromTo(".entry-stage > *", { y: 30, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.06, duration: 0.35, ease: "back.out(1.5)" });
      return;
    }

    if (mode === "make") {
      stage.append(
        h("h3", { class: "entry-mode-title" }, [h("span", { class: "entry-ransom" })]),
        h("p", { class: "entry-sub" }, ["Create a class and share its code with your students."]),
      );
      ransomize(stage.querySelector<HTMLElement>(".entry-ransom")!, "MAKE A CLASS", { size: "clamp(26px,3.6vw,46px)" });
      const input = h("input", { class: "fill-input entry-code", placeholder: "Class name, e.g. 6A Physics", maxlength: "60", spellcheck: "false" });
      stage.append(
        h("div", { class: "entry-field" }, [input]),
        h("div", { class: "entry-actions" }, [
          h("button", { class: "sticker-btn accent entry-next" }, ["CONTINUE ▸"]),
          h("button", { class: "sticker-btn entry-back" }, ["◀ BACK"]),
        ]),
      );
      const name = input as HTMLInputElement;
      name.focus();
      const proceed = () => {
        const v = name.value.trim();
        if (v.length < 2) {
          toast("Give the class a name (2+ characters)", "error");
          fx.shake(6);
          return;
        }
        pendingClass = v; // reuse as "pending value"
        pendingMake = true;
        mode = cloud.session ? "create" : "auth";
        render();
      };
      stage.querySelector(".entry-next")!.addEventListener("click", proceed);
      stage.querySelector(".entry-back")!.addEventListener("click", back);
      name.addEventListener("keydown", (e) => { if (e.key === "Enter") proceed(); });
      if (!RM()) gsap.fromTo(".entry-stage > *", { y: 30, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.06, duration: 0.35, ease: "back.out(1.5)" });
      return;
    }

    if (mode === "create") {
      // logged in + make class
      stage.append(
        h("h3", { class: "entry-mode-title" }, [h("span", { class: "entry-ransom" })]),
        h("p", { class: "entry-sub" }, [`Creating “${pendingClass}” as ${cloud.session?.user.username}…`]),
        h("div", { class: "entry-actions" }, [
          h("button", { class: "sticker-btn accent entry-next" }, ["CREATE CLASS ★"]),
          h("button", { class: "sticker-btn entry-back" }, ["◀ BACK"]),
        ]),
      );
      ransomize(stage.querySelector<HTMLElement>(".entry-ransom")!, "CONFIRM", { size: "clamp(26px,3.6vw,46px)" });
      stage.querySelector(".entry-next")!.addEventListener("click", async () => {
        const r = await cloud.createClass(pendingClass!);
        if (r.ok) {
          toast(`Class “${pendingClass}” created`, "info");
          fx.starBurst(window.innerWidth / 2, window.innerHeight / 2, { gold: true, n: 16 });
          void go({ name: "dashboard" });
        } else {
          toast(cloudError(r), "error");
          fx.shake(8);
        }
      });
      stage.querySelector(".entry-back")!.addEventListener("click", back);
      return;
    }

    // auth — join-first: credentials with the pending class code/name
    stage.append(
      h("h3", { class: "entry-mode-title" }, [h("span", { class: "entry-ransom" })]),
      h("p", { class: "entry-sub" }, [
        pendingMake
          ? "Sign in or create an account, then your class will be created."
          : `Joining class ${pendingClass} — sign in or create an account.`,
      ]),
    );
    ransomize(stage.querySelector<HTMLElement>(".entry-ransom")!, "SIGN IN", { size: "clamp(26px,3.6vw,46px)" });
    const userField = field("USERNAME", "text", "phantom_name");
    const passField = field("PASSWORD", "password", "8+ characters");
    const emailField = field("EMAIL (OPTIONAL)", "email", "you@school.com");
    stage.append(
      h("div", { class: "entry-form" }, [userField, emailField, passField]),
      h("div", { class: "entry-actions" }, [
        h("button", { class: "sticker-btn accent entry-login" }, ["SIGN IN"]),
        h("button", { class: "sticker-btn entry-register" }, ["CREATE ACCOUNT"]),
        h("button", { class: "sticker-btn entry-back" }, ["◀ BACK"]),
      ]),
    );
    const u = userField.querySelector<HTMLInputElement>("input")!;
    const e = emailField.querySelector<HTMLInputElement>("input")!;
    const p = passField.querySelector<HTMLInputElement>("input")!;
    u.focus();
    const attempt = async (register: boolean) => {
      const username = u.value.trim();
      const password = p.value;
      if (username.length < 3 || password.length < 8) {
        toast("Username 3+ · password 8+ characters", "error");
        fx.shake(6);
        return;
      }
      const classCode = pendingMake ? undefined : (pendingClass ?? undefined);
      const r = register
        ? await cloud.register(username, password, e.value.trim(), classCode)
        : await cloud.login(username, password, classCode);
      if (r.ok) {
        if (pendingMake && !classCode) {
          const created = await cloud.createClass(pendingClass!);
          if (created.ok) {
            toast(`Class “${pendingClass}” created`, "info");
          }
        }
        toast(`Welcome, ${cloud.session?.user.username}`, "info");
        void go({ name: "dashboard" });
        return;
      }
      toast(cloudError(r), "error");
      fx.shake(8);
      if (r.status === 404) {
        toast("No class with that code", "error");
        mode = "join";
        render();
      }
    };
    stage.querySelector(".entry-login")!.addEventListener("click", () => void attempt(false));
    stage.querySelector(".entry-register")!.addEventListener("click", () => void attempt(true));
    stage.querySelector(".entry-back")!.addEventListener("click", back);
    p.addEventListener("keydown", (ev) => { if (ev.key === "Enter") void attempt(false); });
    if (!RM()) gsap.fromTo(".entry-stage > *", { y: 30, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.06, duration: 0.35, ease: "back.out(1.5)" });
  };

  el.querySelector("#hud-top .hud-tag")!.addEventListener("click", back);

  root.appendChild(el);
  render();
  if (!RM()) {
    gsap.fromTo("#hud-top .hud-tag", { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, stagger: 0.08, ease: "power3.out" });
  }
  return () => undefined;
});
