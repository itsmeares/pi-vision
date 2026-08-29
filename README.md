# pi-vision

Delegated vision for [Pi](https://github.com/earendil-works/pi). `pi-vision` registers a `vision` tool so a text-only primary model can inspect local images without ever receiving pixels itself.

```text
text-only Pi model
      |
      | vision(images, question)
      v
pi-vision extension
      |
      | isolated codex exec
      v
GPT-5.6 Luna (low reasoning)
      |
      | concise text result
      v
text-only Pi model
```

The delegate runs in a separate Codex environment with a fresh working directory, read-only sandboxing, no session persistence, and only the existing Codex authentication shared back in.

## Requirements

- Pi with extension/package support
- Codex CLI available as `codex`
- Existing Codex login at `~/.codex/auth.json` (`codex login` if needed)

No model or image support is required from the primary Pi model.

## Install as a Pi package

This repository is a Pi package. Install it globally once and the `vision` tool is available in Pi sessions across projects:

```bash
pi install git:github.com/itsmeares/pi-vision
```

For a private repository, use whichever Git URL your existing Git authentication can access, for example SSH:

```bash
pi install git:git@github.com:itsmeares/pi-vision
```

Update it later with:

```bash
pi update --extension git:github.com/itsmeares/pi-vision
```

Remove it with:

```bash
pi remove git:github.com/itsmeares/pi-vision
```

Pi package metadata lives in `package.json`; the extension itself remains in `.pi/extensions/delegated-vision.ts`, so the repository also works directly as a project-local development checkout.

## Usage

The model calls the tool when it needs visual information:

```text
vision({
  images: ["screenshot.png"],
  question: "What error is shown?"
})
```

The result returned to the primary model is text only.

Tool input:

- `images`: 1–4 local image paths, absolute or project-relative
- Supported image types: jpg, jpeg, png, webp, gif, bmp
- Maximum size: 10 MB per image
- `question`: a focused question about the supplied image(s)

## How delegation works

Each tool call:

1. Validates and resolves the image paths locally.
2. Creates an isolated delegate home at `~/.codex/vision` if needed.
3. Keeps only an `auth.json` symlink there, pointing at the normal `~/.codex/auth.json`.
4. Creates a fresh temporary working directory.
5. Runs an ephemeral, read-only `codex exec` with the requested image(s).
6. Uses GPT-5.6 Luna with low reasoning by default.
7. Captures only the delegate's final stdout and returns it to Pi.
8. Removes the temporary working directory.

The primary model remains text-only throughout the call.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PI_VISION_MODEL` | `gpt-5.6-luna` | Delegate model |
| `PI_VISION_EFFORT` | `low` | Codex reasoning effort |
| `PI_VISION_TIMEOUT_MS` | `180000` | Per-call timeout |
| `PI_VISION_CODEX` | `codex` | Codex executable path |
| `PI_VISION_HOME` | `~/.codex/vision` | Delegate `CODEX_HOME` |

## Isolation boundaries

The extension deliberately avoids inheriting the normal Codex project environment:

- Dedicated `CODEX_HOME`: no normal `config.toml`, user `AGENTS.md`, enabled plugins, hooks, or MCP configuration.
- Fresh empty cwd plus `--skip-git-repo-check`: no repository context or project `AGENTS.md` is loaded from the caller's repo.
- `--ephemeral`: no delegated session is persisted.
- `-s read-only`: the delegated Codex run is sandboxed read-only.
- `OPENAI_API_KEY` and `CODEX_API_KEY` are removed from the child environment so the existing ChatGPT/Codex auth file is used.
- The temporary cwd is deleted after the call.

Two boundaries are intentionally shared:

- `~/.codex/auth.json` is symlinked rather than copied so normal token refresh continues to work.
- Codex can discover shared skills under `~/.agents/skills/`, which sits outside `CODEX_HOME`. They were observed during verification but are not required by the vision tool.

## Verified behavior

The extension has been exercised end-to-end from a real Pi session using a text-only primary model:

```text
Pi model -> vision tool -> isolated Codex delegate -> image description -> Pi model
```

The verification covered a real PNG, missing-file handling, non-image rejection, cancellation, and delegate cleanup.

## Repository layout

```text
.pi/extensions/delegated-vision.ts  # extension implementation
package.json                        # Pi package manifest
README.md                           # installation and behavior
plan/                               # original implementation/design notes
```
