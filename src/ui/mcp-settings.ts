/* ============ P5 QUIZ — MCP ACCESS ============
 * One local authoring key, generated on this device. The token is shown once
 * and never stored: the MCP server reads it from its launch environment.
 * The hosted block is a deliberate placeholder for the later server-issued
 * key list (issue/revoke/scopes), not a fake working key manager.
 */
import { h } from "./dom";
import { t } from "../core/i18n";
import { audio } from "../core/audio";

const INBOX = "http://127.0.0.1:3848";
const SCOPES = ["author:validate", "author:save"] as const;
type Scope = (typeof SCOPES)[number];

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `p5q_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function mcpSettings(): HTMLElement {
  let token = "";
  const selected = new Set<Scope>(SCOPES);
  const status = h("p", { class: "note", role: "status", "aria-live": "polite" });
  const tokenInput = h("input", {
    class: "security-token mcp-token",
    type: "text",
    readonly: "readonly",
    hidden: true,
    "aria-label": t("Local MCP token"),
  }) as HTMLInputElement;
  const command = h("code", { class: "mcp-command" });
  const launchRow = h("div", { class: "mcp-launch", hidden: true }, [
    h("span", { class: "field-label" }, [t("Launch the local server with")]),
    command,
  ]);
  const config = h("code", { class: "mcp-command" });
  const configRow = h("div", { class: "mcp-launch", hidden: true }, [
    h("span", { class: "field-label" }, [t("MCP client environment")]),
    config,
  ]);

  const refresh = () => {
    const scopeText = [...selected].join(" ");
    if (!token) {
      launchRow.hidden = true;
      configRow.hidden = true;
      return;
    }
    launchRow.hidden = false;
    configRow.hidden = false;
    command.textContent = `P5Q_MCP_TOKEN=${token}${scopeText ? ` P5Q_MCP_SCOPES="${scopeText}"` : ""} npm run mcp`;
    config.textContent = JSON.stringify(
      {
        environment: {
          P5Q_MCP_TOKEN: token,
          ...(scopeText ? { P5Q_MCP_SCOPES: scopeText } : {}),
        },
      },
      null,
      2,
    );
  };

  const copy = async (text: string, label: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = t("{label} copied.", { label });
      status.className = "note is-ok";
    } catch {
      status.textContent = t("Copy failed — select the field and copy it manually.");
      status.className = "note is-amber";
    }
  };

  const generate = h("button", { class: "sticker-btn", type: "button" }, [t("Generate key")]);
  generate.addEventListener("click", () => {
    token = newToken();
    tokenInput.value = token;
    tokenInput.hidden = false;
    tokenInput.focus();
    tokenInput.select();
    refresh();
    audio.sfx("select");
    status.textContent = t("Key generated. It is shown once and not stored.");
    status.className = "note is-ok";
  });

  const copyToken = h("button", { class: "sticker-btn", type: "button" }, [t("Copy token")]);
  copyToken.addEventListener("click", () => void copy(token, t("Token")));

  const copyCommand = h("button", { class: "sticker-btn", type: "button" }, [t("Copy launch command")]);
  copyCommand.addEventListener("click", () => void copy(command.textContent ?? "", t("Launch command")));

  const copyConfig = h("button", { class: "sticker-btn", type: "button" }, [t("Copy MCP config")]);
  copyConfig.addEventListener("click", () => void copy(config.textContent ?? "", t("MCP config")));

  const check = h("button", { class: "sticker-btn", type: "button" }, [t("Check local server")]);
  check.addEventListener("click", async () => {
    status.textContent = t("Checking local server…");
    status.className = "note";
    try {
      const response = await fetch(`${INBOX}/health`, { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { ok?: boolean };
      if (!body.ok) throw new Error("not ok");
      status.textContent = t("Local server is online on 127.0.0.1:3848.");
      status.className = "note is-ok";
    } catch {
      status.textContent = t("No local server on 127.0.0.1:3848. Start it with `npm run mcp`.");
      status.className = "note is-amber";
    }
  });

  const scopeRow = h(
    "div",
    { class: "mcp-scopes", role: "group", "aria-label": t("MCP scopes") },
    SCOPES.map((scope) => {
      const box = h("input", {
        type: "checkbox",
        checked: "checked",
        "data-scope": scope,
        "aria-label": scope,
      }) as HTMLInputElement;
      box.addEventListener("change", () => {
        if (box.checked) selected.add(scope);
        else selected.delete(scope);
        refresh();
      });
      return h("label", { class: "mcp-scope" }, [box, h("span", {}, [scope])]);
    }),
  );

  const revoke = h("button", { class: "sticker-btn mcp-revoke", type: "button" }, [t("Forget key")]);
  revoke.addEventListener("click", () => {
    token = "";
    tokenInput.value = "";
    tokenInput.hidden = true;
    refresh();
    status.textContent = t("Key forgotten on this screen. Restart the server without the token to fully revoke it.");
    status.className = "note is-amber";
  });

  const block = h("div", { class: "mcp-block" }, [
    h("p", { class: "note" }, [
      t("The local authoring server can be protected with one token. Generate it, copy the launch command, then keep the server local."),
    ]),
    scopeRow,
    h("div", { class: "mcp-actions" }, [generate, copyToken, check]),
    tokenInput,
    h("div", { class: "mcp-actions" }, [copyCommand, copyConfig, revoke]),
    launchRow,
    configRow,
    status,
    h("p", { class: "note" }, [
      t("The token is shown once and never stored. The server must be restarted with the matching environment."),
    ]),
    h("div", { class: "mcp-hosted" }, [
      h("span", { class: "field-label" }, [t("Hosted MCP keys")]),
      h("span", { class: "mcp-soon" }, [t("Planned")]),
      h("p", { class: "note" }, [
        t("Server-issued, scoped and revocable keys will live here once the hosted MCP transport exists. This build is local-only."),
      ]),
    ]),
  ]);

  refresh();
  return block;
}
