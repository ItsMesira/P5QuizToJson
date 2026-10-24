/* ============ STUDIO HOME ============
 * The unthemed default. It deliberately does not use the P5 title machinery:
 * no ransom lettering, no stripe wipe, no Persona art. Routing and settings are
 * the same old app; only the surface changes.
 */
import { go } from "./screens";
import { h } from "./dom";
import { audio } from "../core/audio";
import { cloud } from "../core/api";
import { t } from "../core/i18n";
import gsap from "gsap";
import { RM } from "../fx/transitions";
import type { Route } from "./screens";

interface StudioRoute {
  index: string;
  label: string;
  detail: string;
  route: () => Route;
}

const ROUTES: StudioRoute[] = [
  {
    index: "01",
    label: "Start a quiz",
    detail: "Drop a JSON, paste one, or claim an AI-authored quiz.",
    route: () => ({ name: "load" }),
  },
  {
    index: "02",
    label: "Library",
    detail: "Your saved quizzes, history and unfinished runs.",
    route: () => ({ name: "library" }),
  },
  {
    index: "03",
    label: "AI Author",
    detail: "Build a prompt, then claim the finished quiz.",
    route: () => ({ name: "prompts" }),
  },
  {
    index: "04",
    label: "Profiles",
    detail: "Local players, XP and the runs that made them.",
    route: () => ({ name: "profiles" }),
  },
  {
    index: "05",
    label: "Classroom",
    detail: "Join a class, share a shelf, climb the board.",
    route: () => (cloud.session ? { name: "dashboard" } : { name: "entry" }),
  },
  {
    index: "06",
    label: "Settings",
    detail: "Appearance, language, audio and data.",
    route: () => ({ name: "settings" }),
  },
];

export function mountStudioHome(root: HTMLElement): void {
  const button = (label: string, detail: string, onClick: () => void) => {
    const el = h("button", { class: "studio-row", type: "button" }, [
      h("span", { class: "studio-row-index" }, [ROUTES.find((r) => r.label === label)?.index ?? ""]),
      h("span", { class: "studio-row-body" }, [
        h("span", { class: "studio-row-label" }, [t(label)]),
        h("span", { class: "studio-row-detail" }, [t(detail)]),
      ]),
      h("span", { class: "studio-row-arrow", "aria-hidden": "true" }, ["↗"]),
    ]);
    el.addEventListener("mouseenter", () => audio.sfx("hover"));
    el.addEventListener("click", onClick);
    return el;
  };

  const goRoute = (route: () => Route) => {
    audio.sfx("select");
    void go(route());
  };

  const menu = h("nav", { class: "studio-menu", "aria-label": t("Main") }, [
    h("div", { class: "studio-menu-head" }, [
      h("span", {}, [t("Index")]),
      h("span", {}, [t("Choose a route")]),
    ]),
    ...ROUTES.map((item) =>
      button(item.label, item.detail, () => goRoute(item.route)),
    ),
  ]);

  const primary = h("button", { class: "studio-btn studio-btn-primary", type: "button" }, [
    t("Start a quiz"),
    h("span", { "aria-hidden": "true" }, ["↗"]),
  ]);
  primary.addEventListener("mouseenter", () => audio.sfx("hover"));
  primary.addEventListener("click", () => goRoute(() => ({ name: "load" })));

  const author = h("button", { class: "studio-btn studio-btn-quiet", type: "button" }, [t("Author with AI")]);
  author.addEventListener("mouseenter", () => audio.sfx("hover"));
  author.addEventListener("click", () => goRoute(() => ({ name: "prompts" })));

  const el = h("div", { class: "screen studio-title", "data-screen": "studio" }, [
    h("header", { class: "studio-top" }, [
      h("div", { class: "studio-brand" }, [
        h("span", { class: "studio-brand-mark" }, ["P5"]),
        h("span", { class: "studio-brand-word" }, ["Quiz"]),
      ]),
      h("div", { class: "studio-meta" }, [
        h("span", {}, [t("Studio")]),
        h("span", { class: "studio-meta-rule", "aria-hidden": "true" }, []),
        h("span", {}, [t("Local-first")]),
        h("span", { class: "studio-meta-rule", "aria-hidden": "true" }, []),
        h("span", {}, ["v2"]),
      ]),
    ]),
    h("main", { class: "studio-main" }, [
      h("section", { class: "studio-copy" }, [
        h("p", { class: "studio-eyebrow" }, [t("A quiet instrument for loud ideas")]),
        h("h1", { class: "studio-title-name" }, [t("Make it"), h("br"), t("stick.")]),
        h("p", { class: "studio-lede" }, [
          t("A local-first quiz engine for people who want the work to stay in their hands. Nine question types, no feed, no noise."),
        ]),
        h("div", { class: "studio-actions" }, [primary, author]),
        h("p", { class: "studio-footnote" }, [
          h("span", { class: "studio-status-dot", "aria-hidden": "true" }, []),
          t("Nothing leaves this browser unless you choose it."),
        ]),
      ]),
      menu,
    ]),
    h("footer", { class: "studio-bottom" }, [
      h("span", {}, [t("Nine question types · six languages · one clean loop")]),
      h("span", {}, [t("Built for the work")]),
    ]),
  ]);

  root.appendChild(el);

  if (!RM()) {
    gsap.from(el.querySelectorAll(".studio-copy > *"), {
      y: 18,
      opacity: 0,
      duration: 0.5,
      stagger: 0.06,
      ease: "power3.out",
    });
    gsap.from(el.querySelectorAll(".studio-top, .studio-menu-head, .studio-row, .studio-bottom"), {
      y: 12,
      opacity: 0,
      duration: 0.42,
      stagger: 0.045,
      delay: 0.08,
      ease: "power3.out",
    });
  }
}
