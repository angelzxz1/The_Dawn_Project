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
//   node scripts/desktop.mjs dev [more tauri arguments]
//   node scripts/desktop.mjs build [more tauri arguments]

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

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
const childEnv = { ...process.env };
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

const result = spawnSync("npx", args, { stdio: "inherit", shell: true, env: childEnv });
process.exit(result.status ?? 1);
