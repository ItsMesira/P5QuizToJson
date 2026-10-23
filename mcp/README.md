# p5-quiz-author — local MCP server

The cousin of Study's `study-author` MCP, for **P5 Quiz**. It gives an MCP
client four tools that use the *same* TypeScript schema, validator and repairer
as the game, then places a validated quiz in a loopback inbox the app can claim.

This is local-only. It binds `127.0.0.1:3848`; there is no hosted transport and
no quiz content is logged.

## Run

```sh
cd "Json to quiz P5"
npm run mcp
```

`npm run mcp` builds `mcp/.build/core.mjs` from `src/core/*` and starts the
stdio server. The HTTP inbox is a sidecar on the same process.

In the app: **Load a Quiz → ✦ FROM MCP**, paste the code, **CLAIM**.

## Tools

| Tool | Purpose |
|---|---|
| `get_quiz_rules` | Exact JSON schema, hard rules, supported question types. |
| `build_quiz_prompt` | The real master prompt. Takes `topic` plus optional count, types, language, difficulty, notes… |
| `validate_quiz` | Validate/repair raw JSON. Returns the repaired quiz, a repair log, and named errors; never throws for bad content. |
| `save_quiz` | Validate/repair and put the quiz in the inbox. Returns a single-use code valid for 10 minutes. |

Typical agent flow:

1. `get_quiz_rules` (or call `build_quiz_prompt` with the topic).
2. Write raw quiz JSON against that contract.
3. `validate_quiz`; fix only the named paths.
4. `save_quiz`; hand the returned `ABC-123-XYZ` code to the user.

## MCP client config

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "p5-quiz-author": {
      "type": "local",
      "command": [
        "node",
        "/absolute/path/to/Json to quiz P5/mcp/server.mjs"
      ],
      "enabled": true
    }
  }
}
```

The command path contains a space, so keep it as one array element. Use an
absolute path when the client does not start in this folder. The server expects
`mcp/.build/core.mjs`; run `npm run mcp:build` once after cloning, or use
`npm run mcp` which does both.

### Optional token and scopes

By default the loopback inbox is open to local processes, which is the same
trust model as a local dev server. To require a bearer token:

```sh
P5Q_MCP_TOKEN="$(openssl rand -hex 24)" npm run mcp
```

Then put the same value in the MCP client's `environment` block:

```json
"environment": {
  "P5Q_MCP_TOKEN": "paste-the-same-value"
}
```

The default scopes are `author:validate author:save`. Override with
`P5Q_MCP_SCOPES`; a token without `author:save` can validate but not write to
the inbox. Never commit a real token.

| Variable | Default | Meaning |
|---|---|---|
| `P5Q_MCP_INBOX_PORT` | `3848` | Loopback HTTP port. |
| `P5Q_MCP_TOKEN` | empty | Optional bearer token for save. |
| `P5Q_MCP_SCOPES` | `author:validate author:save` | Scopes enforced when a token is set. |

## Claim path and CSP

The browser calls only:

```
GET http://127.0.0.1:3848/api/inbox/claim?code=...
```

`vercel.json` therefore adds `http://127.0.0.1:3848` to `connect-src`. The inbox
is memory-only, single-use and ten-minute TTL. It accepts CORS from local dev
ports plus the P5 production/preview origins; it does not accept credentials.

## Tests

```sh
npm run mcptest
```

The test builds the core, starts the real stdio server and inbox on a test port,
exercises all four tools, proves the token rejection and single-use claim, and
kills its own server. It does not touch the network beyond `127.0.0.1`.

## Security notes

- Do not expose port 3848 or the stdio server through a tunnel.
- Do not add the inbox token to the browser bundle. The app only needs the
  one-use claim code.
- `save_quiz` re-validates at the inbox boundary; a direct POST cannot inject
  an invalid or unnormalized quiz.
- The hosted-quiz path is unrelated: this server only writes to localhost.
