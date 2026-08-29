# pi-vision

A [pi](https://github.com/badlogic/pi) extension that gives a **text-only model** (e.g. `q38s`) delegated vision: it calls a `vision` tool, an isolated `codex exec` (GPT-5.6 Luna, low reasoning) looks at the images, and only the final **text** answer comes back. The primary model never sees pixels.

```
q38s (text-only) ── vision(images, question) ──▶ codex exec (isolated) ──▶ GPT-5.6 Luna
       ▲                                                        │
       └────────────────── plain text answer ◀──────────────────┘
```

## Install

No build step. With this repo checked out as your working directory, pi auto-discovers `.pi/extensions/delegated-vision.ts`. First use bootstraps `~/.codex/vision/` (mode 0700) containing only a symlink to `~/.codex/auth.json`, so the delegate reuses your existing ChatGPT auth. Re-auth: `codex login` as usual.

## Usage

Nothing to type — the model calls the tool when it needs to understand an image:

```
model:  vision({ images: ["screenshot.png"], question: "What error is shown?" })
tool:   "The red banner reads 'Connection refused: postgres:5432'."
```

- `images`: 1–4 local image paths (absolute or project-relative; jpg/jpeg/png/webp/gif/bmp, ≤ 10 MB each)
- `question`: what to look for
- Returns concise plain text only; `details` carries the image list, model, and elapsed ms

## Configuration (env)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PI_VISION_MODEL` | `gpt-5.6-luna` | Delegate model |
| `PI_VISION_EFFORT` | `low` | Reasoning effort (`-c model_reasoning_effort=`) |
| `PI_VISION_TIMEOUT_MS` | `180000` | Per-call timeout (process group is SIGKILL'd) |
| `PI_VISION_CODEX` | `codex` | Path to the codex binary |
| `PI_VISION_HOME` | `~/.codex/vision` | Delegate `CODEX_HOME` (testing) |

## Isolation

The delegate is isolated from your normal Codex setup by construction:

- **Dedicated `CODEX_HOME`** with only the `auth.json` symlink — no `config.toml`, no user `AGENTS.md`, no plugin enablements, no hooks, no MCP servers to load
- **Fresh empty temp dir** as cwd + `--skip-git-repo-check` — no project `AGENTS.md`, no git context
- **`--ephemeral`** (no session files) and **`-s read-only`** sandbox
- **Env hygiene**: `OPENAI_API_KEY`/`CODEX_API_KEY` stripped so ChatGPT auth from `auth.json` is used
- The working temp dir is removed after every call

Notes / known scope:

- Codex bootstraps *system* content into any fresh `CODEX_HOME` (system skills under `skills/.system/`, a cache of the curated plugin registry). None of it is enabled — verified: the delegate reports only base tools (read-only shell, web search, imagegen) and no plugin/MCP/hook capabilities.
- Codex also discovers **shared agent skills from `~/.agents/skills/`**, which is outside `CODEX_HOME` and cannot be isolated via `CODEX_HOME`. Those skills (design/frontend toolkit) are present in the delegate's context but inert for image QA. If you want them gone from the delegate too, run the delegate with a `HOME`-override that lacks `.agents/skills` — intentionally not done by default.
- Auth is a **symlink, not a copy**: token refreshes from the delegate rotate the real `~/.codex/auth.json`, which is what keeps both the delegate and your main Codex working.
- One `codex exec` process per call (~1–2 s spawn overhead). Fine for occasional image Q&A; a resident delegate is a possible later optimization.

## Files

```
.pi/extensions/delegated-vision.ts   # the whole extension (single file, no deps)
```
