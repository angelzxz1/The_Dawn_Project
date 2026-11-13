// Runs the Tauri CLI (`dev` or `build`) for the desktop app, turning on
// ASIO when `.env` says so:
//
//   DAWN_ASIO=1
//
// ASIO stays off otherwise (see docs/desktop.md: it needs Steinberg's
// licence agreement before a build with it goes to anyone). Building with it
// needs LLVM installed on Windows; cpal fetches the ASIO SDK itself, or reads
// it from CPAL_ASIO_DIR.
//
// A build signs the installers when the environment holds this platform's
// signing settings (scripts/signing.mjs), as the installers workflow does
// once they're set up; otherwise it's unsigned.
//
//   node scripts/desktop.mjs dev [more tauri arguments]
//   node scripts/desktop.mjs build [more tauri arguments]

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { signing } from "./signing.mjs";

const [command = "dev", ...rest] = process.argv.slice(2);

/** `.env`'s values, with the environment's own taking precedence. */
function env(name) {
  if (process.env[name] !== undefined) return process.env[name];
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    const value = parseEnv(readFileSync(file, "utf8"))[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

const asio = /^(1|true|yes|on)$/i.test((env("DAWN_ASIO") ?? "").trim());
const args = ["--yes", "@tauri-apps/cli@2", command, ...rest];
let childEnv = { ...process.env };
if (asio) {
  if (process.platform === "win32") {
    // The SDK's bindings are made with libclang, from LLVM.
    const dirs = [env("LIBCLANG_PATH"), "C:\\Program Files\\LLVM\\bin"].filter(Boolean);
    const dir = dirs.find((d) => existsSync(`${d}\\libclang.dll`) || existsSync(`${d}\\clang.dll`));
    if (!dir) {
      console.error(
        "DAWN_ASIO is on, but building with ASIO needs LLVM, which isn't installed.\n" +
          "Install it with:  winget install LLVM.LLVM\n" +
          "or set LIBCLANG_PATH in .env to the folder holding libclang.dll,\n" +
          "or turn ASIO off with DAWN_ASIO=0.",
      );
      process.exit(1);
    }
    childEnv.LIBCLANG_PATH = dir;
  }
  args.push("--features", "asio");
  console.log("DAWN_ASIO is on: building with ASIO.");
  if (command === "build") console.log("Don't share this build: ASIO isn't licensed for distribution yet.");
}

if (command === "build") {
  const sign = signing(childEnv, process.platform);
  childEnv = sign.env;
  if (sign.missing.length > 0) {
    console.error(`Some of the signing settings are set, but not these: ${sign.missing.join(", ")}.
Set them all to sign the installers, or none to build them unsigned.`);
    process.exit(1);
  }
  if (sign.config && asio) {
    // A signed build is one to hand out, and ASIO can't be handed out yet.
    console.error("ASIO is on, so this build isn't signed: it can't be shared until Steinberg's licence is signed.\nTurn ASIO off with DAWN_ASIO=0 to sign it.");
    process.exit(1);
  }
  if (sign.config) {
    const file = join(mkdtempSync(join(tmpdir(), "dawn-signing-")), "tauri.signing.json");
    writeFileSync(file, JSON.stringify(sign.config));
    args.push("--config", `"${file}"`);
    console.log("Signing the installers.");
  }
  // Tells the workflow whether to check the signatures.
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `signed=${sign.config ? "true" : "false"}
`);
}

const result = spawnSync("npx", args, { stdio: "inherit", shell: true, env: childEnv });
process.exit(result.status ?? 1);
