import { cp, mkdir, mkdtemp, readFile, writeFile, symlink, lstat, readlink, rename, rm, realpath } from "node:fs/promises";
import { join, resolve, dirname, basename, relative, isAbsolute, sep } from "node:path";

const args = process.argv.slice(2), recovering = args[0] === "--recover";
if (args.length !== 2) throw new Error("Usage: node install.mjs ARTIFACT PREFIX, or node install.mjs --recover PREFIX");
const prefix = resolve(args[1]);
const root = join(prefix, "lib/hot-cross-buns-terminal"), launcher = join(prefix, "bin", process.platform === "win32" ? "hot-cross-buns.cmd" : "hot-cross-buns");
const windowsLauncher = '@echo off\r\nbun "%~dp0..\\lib\\hot-cross-buns-terminal\\bin\\hot-cross-buns" %*\r\n';
const linkTarget = join("..", "lib/hot-cross-buns-terminal/bin/hot-cross-buns");
const runtime = process.platform === "win32" ? "hot-cross-buns-runtime.exe" : "hot-cross-buns-runtime";
const exists = async path => { try { return await lstat(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
async function canonicalDestination(path) {
  try { return await realpath(path); }
  catch (error) { if (error.code !== "ENOENT" || dirname(path) === path) throw error; return join(await canonicalDestination(dirname(path)), basename(path)); }
}
async function requirePackage(directory) {
  const metadata = JSON.parse(await readFile(join(directory, "hot-cross-buns-distribution.json"), "utf8"));
  if (metadata.product !== "hot-cross-buns-terminal" || metadata.version !== 1 || metadata.platform !== process.platform || metadata.arch !== process.arch) throw new Error("This artifact is not a Hot Cross Buns terminal build for this platform/architecture.");
  for (const path of ["bin/hot-cross-buns", `runtime/${runtime}`, "ui/dist/index.js", "ui/package.json", "app-host/package.json"]) {
    if (!(await lstat(join(directory, path))).isFile()) throw new Error(`Required package file is not an ordinary file: ${path}`);
  }
}
async function publishLauncher() {
  await mkdir(dirname(launcher), { recursive: true });
  if (process.platform === "win32") await writeFile(launcher, windowsLauncher, { flag: "wx" });
  else await symlink(linkTarget, launcher);
}
if (recovering) {
  if (!(await lstat(root)).isDirectory()) throw new Error("The installation is not an ordinary directory.");
  const path = join(root, "installation.json");
  if (!(await lstat(path)).isFile()) throw new Error("Installation ownership could not be verified.");
  const manifest = JSON.parse(await readFile(path, "utf8"));
  if (manifest.product !== "hot-cross-buns-terminal" || manifest.version !== 1 || manifest.root !== root || manifest.launcher !== launcher || manifest.prefix !== prefix) throw new Error("Installation ownership could not be verified.");
  await requirePackage(root);
  const current = await exists(launcher);
  if (current) {
    const owned = process.platform === "win32" ? current.isFile() && await readFile(launcher, "utf8") === windowsLauncher : current.isSymbolicLink() && await readlink(launcher) === linkTarget;
    if (!owned) throw new Error("The launcher path belongs to something else; it was not replaced.");
  } else await publishLauncher();
  console.log(`Installation launcher ready: ${launcher}. Profiles and background checks were not changed.`);
} else {
  const artifact = await realpath(resolve(args[0]));
  await requirePackage(artifact);
  for (const path of [root, launcher]) if (await exists(path)) throw new Error(`Installation path already exists: ${path}. Use a new prefix; existing products are not replaced.`);
  const destination = await canonicalDestination(root), inside = relative(artifact, destination);
  if (inside === "" || !isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`)) throw new Error("Choose an installation prefix outside the source artifact.");
  await mkdir(dirname(root), { recursive: true });
  const stage = await mkdtemp(join(dirname(root), ".hot-cross-buns-terminal-install-"));
  try {
    await cp(artifact, stage, { recursive: true, dereference: true });
    await requirePackage(stage);
    await writeFile(join(stage, "installation.json"), JSON.stringify({ product: "hot-cross-buns-terminal", root, launcher, prefix, version: 1 }) + "\n", { mode: 0o600 });
    // Publish only complete packages. Concurrent installers cannot replace a
    // populated installation; the launcher is separately created exclusively.
    if (await exists(root)) throw new Error("The installation path appeared during copying; it was not replaced.");
    await rename(stage, root);
    try { await publishLauncher(); }
    catch (error) { throw new Error(`The complete package is installed, but its launcher could not be created. Resolve the launcher conflict, then run install.mjs with --recover and the same prefix.`, { cause: error }); }
  } finally { await rm(stage, { recursive: true, force: true }); }
  console.log(`Installed ${launcher}. Add ${dirname(launcher)} to PATH. Profiles and background checks were not changed.`);
}
