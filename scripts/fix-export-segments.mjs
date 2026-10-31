// Runs after `next build` (see package.json). Next's static export names
// each page's prefetch files after their segment path with its slashes
// turned into dots ("__next.!KHNpdGUp.features.__PAGE__.txt"), which is
// what its router asks for. On Windows the path it reads has backslashes,
// which it leaves alone, so they come out as folders instead
// ("__next.!KHNpdGUp/features/__PAGE__.txt"), every prefetch 404s and the
// router loads whole pages. This flattens any such folder into the names
// the router asks for; on macOS and Linux there are none, and it does
// nothing.
import { existsSync, readdirSync, renameSync, rmSync } from "fs";
import { join, relative, sep } from "path";

const OUT = new URL("../out/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

/** Every file under a folder, as paths relative to it. */
function filesIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesIn(path).map((p) => join(entry.name, p)) : [entry.name];
  });
}

let moved = 0;
function fix(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name);
    if (!entry.name.startsWith("__next.")) {
      fix(path);
      continue;
    }
    for (const file of filesIn(path)) {
      const flat = `${entry.name}.${relative(".", file).split(sep).join(".")}`;
      renameSync(join(path, file), join(dir, flat));
      moved++;
    }
    rmSync(path, { recursive: true });
  }
}

if (existsSync(OUT)) {
  fix(OUT);
  if (moved > 0) console.log(`out/: ${moved} prefetch file${moved === 1 ? "" : "s"} renamed to what the router asks for`);
}
