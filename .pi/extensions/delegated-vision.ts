/**
 * Delegated Vision Extension
 *
 * Keeps the primary model (e.g. q38s) completely text-only. When it needs to
 * understand local images, it calls the `vision` tool, which delegates the
 * visual analysis to an isolated `codex exec` (GPT-5.6 Luna, low reasoning)
 * and returns only the final text answer.
 *
 * Isolation of the delegate:
 * - Dedicated CODEX_HOME at ~/.codex/vision containing ONLY a symlink to the
 *   real ~/.codex/auth.json (reuses live ChatGPT auth; token refreshes write
 *   through to the real file). No config.toml, AGENTS.md, plugins, hooks, or
 *   MCP servers exist there, so none can load.
 * - Runs with --cd into a fresh empty temp dir plus --skip-git-repo-check,
 *   so no project AGENTS.md or git context leaks in.
 * - Read-only sandbox, no session persistence (--ephemeral), clean env
 *   (OPENAI_API_KEY stripped so ChatGPT auth from auth.json is used).
 *
 * Overrides (env): PI_VISION_MODEL, PI_VISION_EFFORT, PI_VISION_TIMEOUT_MS,
 * PI_VISION_CODEX (path to the codex binary), PI_VISION_HOME (delegate CODEX_HOME).
 */

import { spawn } from "node:child_process";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readlinkSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	unlinkSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MODEL_ID = process.env.PI_VISION_MODEL ?? "gpt-5.6-luna";
const REASONING_EFFORT = process.env.PI_VISION_EFFORT ?? "low";
const TIMEOUT_MS = Number(process.env.PI_VISION_TIMEOUT_MS ?? 180_000);
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"]);
const CODEX_BIN = process.env.PI_VISION_CODEX ?? "codex";

const CODEX_HOME = join(homedir(), ".codex");
const DELEGATE_HOME = process.env.PI_VISION_HOME ?? join(CODEX_HOME, "vision");
const REAL_AUTH = join(CODEX_HOME, "auth.json");
const LINK_AUTH = join(DELEGATE_HOME, "auth.json");

interface VisionDetails {
	images: string[];
	model: string;
	elapsed_ms?: number;
}

function ensureDelegateHome(): string {
	let st;
	try {
		st = statSync(REAL_AUTH);
	} catch {
		st = undefined;
	}
	if (!st?.isFile()) {
		throw new Error(
			`Vision delegation unavailable: no Codex auth at ${REAL_AUTH}. Run 'codex login' first.`,
		);
	}
	mkdirSync(DELEGATE_HOME, { recursive: true, mode: 0o700 });
	// Keep the auth symlink current (self-heals if codex ever replaced it).
	try {
		const link = lstatSync(LINK_AUTH);
		if (!link.isSymbolicLink() || readlinkSync(LINK_AUTH) !== REAL_AUTH) {
			unlinkSync(LINK_AUTH);
			symlinkSync(REAL_AUTH, LINK_AUTH);
		}
	} catch {
		symlinkSync(REAL_AUTH, LINK_AUTH);
	}
	return DELEGATE_HOME;
}

function resolveImage(raw: string, cwd: string): string {
	let p = raw.trim();
	if (p.startsWith("@")) p = p.slice(1);
	if (!isAbsolute(p)) p = join(cwd, p);
	let real: string;
	try {
		real = realpathSync(p);
	} catch {
		throw new Error(`Image not found: ${raw}`);
	}
	const st = statSync(real);
	if (!st.isFile()) throw new Error(`Not a file: ${raw}`);
	if (!IMAGE_EXTS.has(extname(real).toLowerCase())) {
		throw new Error(`Not a supported image type: ${raw} (allowed: jpg, jpeg, png, webp, gif, bmp)`);
	}
	if (st.size === 0) throw new Error(`Image is empty: ${raw}`);
	if (st.size > MAX_IMAGE_BYTES) {
		throw new Error(`Image too large (${(st.size / 1048576).toFixed(1)} MB > 10 MB): ${raw}`);
	}
	return real;
}

function buildPrompt(question: string): string {
	return [
		"You are a delegated vision assistant inside another coding agent. The image(s) attached to this message are your only visual input.",
		"Rules:",
		"- Answer the question from the images alone. Do not use tools or run commands.",
		"- Reply with concise plain text only. No headings or code fences unless the question asks for them.",
		"- If multiple images are attached, refer to them as Image 1, Image 2, ... in the order given.",
		"- If the images do not contain enough information to answer, say so in one line and state what is missing.",
		"",
		`Question: ${question}`,
	].join("\n");
}

interface CodexRun {
	stdout: string;
	stderr: string;
	code: number;
	timedOut: boolean;
}

function runCodex(
	args: string[],
	cwd: string,
	env: NodeJS.ProcessEnv,
	signal: AbortSignal | undefined,
	timeoutMs: number,
): Promise<CodexRun> {
	return new Promise((resolvePromise) => {
		let finished = false;
		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const child = spawn(CODEX_BIN, args, {
			cwd,
			env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});

		const kill = () => {
			const pid = child.pid;
			if (pid === undefined) return;
			try {
				process.kill(-pid, "SIGKILL");
			} catch {
				try {
					child.kill("SIGKILL");
				} catch {
					/* already gone */
				}
			}
		};

		const timer = setTimeout(() => {
			timedOut = true;
			kill();
		}, timeoutMs);
		const onAbort = () => kill();
		signal?.addEventListener("abort", onAbort);

		child.stdout.on("data", (d) => {
			stdout += d;
		});
		child.stderr.on("data", (d) => {
			stderr += d;
		});

		const finish = (result: CodexRun) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			if (!finished) {
				finished = true;
				resolvePromise(result);
			}
		};

		child.on("error", (err) => {
			finish({ stdout, stderr: stderr + "\n" + String(err), code: -1, timedOut });
		});
		child.on("close", (code) => {
			finish({ stdout, stderr, code: code ?? -1, timedOut });
		});
	});
}

export default function delegatedVisionExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "vision",
		label: "Vision",
		description:
			"Analyze one or more local images by delegating to an isolated vision model (Codex CLI, GPT-5.6 Luna, low reasoning). Returns concise text only. Pass local image paths (absolute or project-relative) and a focused question.",
		promptSnippet:
			"Understand local image files: delegate visual analysis to an isolated vision model and receive text",
		parameters: Type.Object({
			images: Type.Array(Type.String(), { minItems: 1, maxItems: MAX_IMAGES }),
			question: Type.String({ minLength: 3 }),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const started = Date.now();
			const delegateHome = ensureDelegateHome();
			const images = params.images.map((p) => resolveImage(p, ctx.cwd));

			const workdir = mkdtempSync(join(tmpdir(), "pi-vision-"));
			// NOTE: the positional prompt MUST come before the -i flags — `-i` uses
			// num_args=1.. and would greedily swallow a trailing positional argument.
			const args = [
				"exec",
				buildPrompt(params.question),
				"--skip-git-repo-check",
				"--ephemeral",
				"-s",
				"read-only",
				"--cd",
				workdir,
				"-m",
				MODEL_ID,
				"-c",
				`model_reasoning_effort=${REASONING_EFFORT}`,
			];
			for (const img of images) args.push("-i", img);

			const env = { ...process.env } as NodeJS.ProcessEnv;
			env.CODEX_HOME = delegateHome;
			delete env.OPENAI_API_KEY;
			delete env.CODEX_API_KEY;

			let run: CodexRun;
			try {
				run = await runCodex(args, workdir, env, signal, TIMEOUT_MS);
			} finally {
				try {
					rmSync(workdir, { recursive: true, force: true });
				} catch {
					/* best effort */
				}
			}

			const baseDetails: VisionDetails = { images, model: MODEL_ID };

			if (signal?.aborted) {
				return { content: [{ type: "text", text: "Vision call cancelled." }], details: baseDetails };
			}
			if (run.timedOut) {
				throw new Error(`Vision delegation timed out after ${Math.round(TIMEOUT_MS / 1000)}s.`);
			}
			if (run.code !== 0) {
				const tail = run.stderr.trim().slice(-800) || run.stdout.trim().slice(-800) || `exit code ${run.code}`;
				throw new Error(`codex exec failed: ${tail}`);
			}
			const text = run.stdout.trim();
			if (!text) throw new Error("Vision delegation returned an empty answer.");

			return {
				content: [{ type: "text", text }],
				details: { ...baseDetails, elapsed_ms: Date.now() - started },
			};
		},
	});
}
