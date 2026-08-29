# Plan: Native delegated-vision tool for Pi (q38s stays text-only)

## What was verified (installed tools, not assumed)

**Pi 0.84.4** (`@earendil-works/pi-coding-agent`):
- Custom tool via `pi.registerTool()` in an extension; project-local `.pi/extensions/*.ts` is auto-discovered once the project is trusted.
- Tool shape: `name`, `description`, `promptSnippet`, `parameters` (typebox), `execute(toolCallId, params, signal, onUpdate, ctx)`; throw = error to model.
- `pi.exec(command, args, { signal, timeout })` → `{ stdout, stderr, code, killed }` — exactly what a delegating tool needs.

**Codex CLI 0.150.1** (`codex exec`), verified against local help + upstream source/docs:
- Non-`--json` mode: *progress → stderr, only the final agent message → stdout* (official noninteractive docs). Simplest possible capture path.
- `-i FILE...` takes raw `PathBuf`s; tests use absolute paths → absolute image paths work from any cwd.
- `-m` model, `-c key=value` overrides, `--cd`, `--skip-git-repo-check`, `--ephemeral` (no session files), `-s read-only` sandbox (already the exec default).
- User-level instructions load from **`$CODEX_HOME/AGENTS.md`** (upstream `codex-home/src/instructions/mod.rs`) — *independent of config.toml*, so `--ignore-user-config` alone would NOT strip your global `~/.codex/AGENTS.md`.
- Project AGENTS.md is walked from project root → cwd; a clean empty cwd + `--skip-git-repo-check` eliminates repo context (incl. this repo's git context).
- Your `~/.codex/config.toml` is where all the "normal Codex" noise lives: 4 plugins (+ponytail), ponytail hooks, `mcp_servers.context7`, project trust entries. None of these are files in a fresh home → a **dedicated `CODEX_HOME` containing only a symlink to `auth.json`** isolates everything by absence, while reusing live ChatGPT OAuth (`auth_mode: chatgpt`, tokens in `auth.json`). Token refreshes write through the symlink to the real file, so normal Codex and the delegate never drift (copying instead would break one-time refresh-token rotation).
- Your config already uses `model = "gpt-5.6-luna"`, `model_reasoning_effort = "low"` — the tool pins both explicitly so delegation doesn't depend on config at all.

## Design (single extension file, no dependencies)

**File:** `.pi/extensions/delegated-vision.ts` in this repo (auto-loaded by Pi here; README will also show global install for other repos).

**Tool `vision`**
- Params: `images: string[]` (1–4, local image paths), `question: string`.
- `execute`:
  1. Normalize each path (strip leading `@`, resolve vs `ctx.cwd`, `realpath`), require file + image extension (jpg/jpeg/png/webp/gif/bmp) + ≤10 MB.
  2. Ensure delegate home `~/.codex/vision` (0700) with `auth.json → ~/.codex/auth.json` symlink (created once). If no real auth file → clear "run `codex login`" error.
  3. Fresh `mkdtemp` work dir; spawn via `pi.exec`:
     ```
     codex exec --skip-git-repo-check --ephemeral -s read-only
       --cd <tmpdir> -m gpt-5.6-luna -c model_reasoning_effort=low
       -i <abs1> [-i <abs2> ...] "<prompt>"
     ```
     env: `CODEX_HOME=~/.codex/vision`, `OPENAI_API_KEY` stripped (force ChatGPT auth path).
  4. Prompt = fixed framing ("vision assistant inside another agent; answer from the images only; do not use tools; plain concise text; label multiple images 1..N in the order given") + the caller's question.
  5. Result: `content[0].text` = trimmed stdout (the final answer only); `details` = `{ images, model, elapsed_ms }`. Non-zero exit / timeout / abort → throw with a short stderr summary.
- `promptSnippet` so q38s sees it in the tools list; constants at top: model, effort, max images, per-image size, timeout 180 s (env-overridable: `PI_VISION_MODEL`, `PI_VISION_TIMEOUT_MS`).

**Files changed**
- `pi-vision/.pi/extensions/delegated-vision.ts` (new, ~150 lines)
- `pi-vision/README.md` (usage: tool contract, delegate home layout, env overrides)

## Build-phase verification (in order)

1. **Live smoke of the raw command** (first thing; needs writes + network, hence build mode): one tiny test PNG through the exact `codex exec` invocation; assert stdout is only the final message and latency/cost feel right.
2. Run `pi` in this repo, ask the text-only model to use `vision` on a sample image → expect concise text back.
3. Negatives: missing file, non-image file, 5 images, aborted call → clean errors, child killed.
4. Confirm delegate home never accumulated config/plugins; `~/.codex/vision` contains only auth symlink + runtime state.

## Tradeoffs & unresolved assumptions

1. **Process-per-call, not a daemon.** Spawning `codex exec` each call costs ~1–2 s startup. A persistent `codex mcp-server`/app-server would be faster but shares one long-lived process (weaker isolation, more state). Simplicity + isolation win for occasional image Q&A; daemon is a later optimization if it becomes hot.
2. **Plain stdout capture, not `--json`.** Official and simplest. JSONL would enable token-usage accounting on the tool result (`usage` is supported by Pi) — left as a stretch item since `gpt-5.6-luna` costs are unknown to Pi.
3. **Symlinked `auth.json` (shared live auth)** vs copying per call. Symlink chosen: refreshes stay consistent for both Codex setups. Consequence: the delegate *can* update your real tokens (same as any Codex run would).
4. **Assumption — `gpt-5.6-luna` reachability.** Assumed it resolves the same way as your interactive setup (it's your configured default). If the model name changes, it's one constant.
5. **Not live-tested end-to-end yet.** This read-only sandbox can't run the real `codex exec` (needs writes to the fresh home + a paid call). Step 1 above is the gate before building the rest.
6. Project-local extension loads only when Pi runs in this repo (trusted). If q38s normally runs elsewhere, install the same file to `~/.pi/agent/extensions/` — README covers both.
