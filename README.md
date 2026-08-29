# pi-vision

Delegated vision for text-only [Pi](https://github.com/earendil-works/pi) models through an isolated Codex CLI worker.

The primary model never receives image input. It calls a `vision` tool, Codex inspects the image, and only the final text answer is returned to Pi.

```text
Pi model (text-only)
        |
        | vision(images, question)
        v
   pi-vision
        |
        | isolated codex exec
        v
GPT-5.6 Luna (low reasoning)
        |
        | text only
        v
Pi model
```

## Install

From npm:

```bash
pi install npm:@itsmeares/pi-vision
```

From GitHub:

```bash
pi install git:github.com/itsmeares/pi-vision
```

Restart Pi after installing the extension.

## Requirements

- Pi
- Codex CLI available as `codex`
- An existing Codex login at `~/.codex/auth.json`

If needed, authenticate once with:

```bash
codex login
```

No vision support is required from the primary Pi model.

## Usage

The extension registers one tool:

```text
vision({
  images: ["screenshot.png"],
  question: "What error is shown?"
})
```

The model can call it whenever it needs to inspect a local image.

Supported input:

- 1-4 images per call
- absolute or project-relative paths
- JPG, JPEG, PNG, WebP, GIF, BMP
- up to 10 MB per image

The tool returns concise plain text to the primary model.

## Isolation

Each delegated call runs with:

- a dedicated `CODEX_HOME` at `~/.codex/vision`
- only a symlink to the existing `~/.codex/auth.json`
- a fresh temporary working directory
- `--ephemeral` session mode
- a read-only Codex sandbox
- no caller repository context
- no normal Codex config, hooks, plugins, MCP configuration, or project instructions from the caller repo

`OPENAI_API_KEY` and `CODEX_API_KEY` are removed from the child environment so the delegate uses the existing Codex login instead.

The temporary working directory is deleted after every call.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PI_VISION_MODEL` | `gpt-5.6-luna` | Codex model used for image analysis |
| `PI_VISION_EFFORT` | `low` | Reasoning effort |
| `PI_VISION_TIMEOUT_MS` | `180000` | Per-call timeout in milliseconds |
| `PI_VISION_CODEX` | `codex` | Codex executable |
| `PI_VISION_HOME` | `~/.codex/vision` | Delegate `CODEX_HOME` |

## Development

Clone the repository and install the checkout directly:

```bash
git clone https://github.com/itsmeares/pi-vision.git
cd pi-vision
pi install "$PWD"
```

The extension implementation is a single file:

```text
.pi/extensions/delegated-vision.ts
```

## License

MIT
