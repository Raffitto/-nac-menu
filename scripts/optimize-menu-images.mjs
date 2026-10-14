#!/usr/bin/env node
/**
 * High-quality menu variants.
 * Small originals are left alone. Heavy photos get one same-size WebP at quality 90.
 * Nothing is upscaled. Aggressive AVIF is not produced. Old 480/960 variants are removed.
 */
import { spawn } from "child_process";
import { readdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";

const root = path.resolve("public");
const heavyBytes = 400_000;
const concurrency = 4;

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("magick", args, { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`magick ${code}`))));
  });
}

async function walk(dir, visit) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, visit);
    else await visit(full, entry.name);
  }
}

await walk(root, async (full, name) => {
  if (/-(480|960)\.(webp|avif)$/i.test(name)) await unlink(full);
});

const files = [];
await walk(root, async (full, name) => {
  if (/\.(jpe?g|png)$/i.test(name) && !/-\d+\.(jpe?g|png)$/i.test(name)) files.push(full);
});

const manifest = { images: {} };
let sourceBytes = 0;
let variantBytes = 0;
let kept = 0;
const queue = [];

for (const file of files) {
  const info = await stat(file);
  sourceBytes += info.size;
  if (info.size < heavyBytes) continue;
  const width = Number(await run(["identify", "-format", "%w", file]));
  if (!Number.isFinite(width) || width < 1) continue;
  queue.push({ file, info, width });
}

let cursor = 0;
async function worker() {
  while (cursor < queue.length) {
    const job = queue[cursor];
    cursor += 1;
    const parsed = path.parse(job.file);
    const dest = path.join(parsed.dir, `${parsed.name}-${job.width}.webp`);
    await run([
      job.file,
      "-auto-orient",
      "-resize", `${job.width}x${job.width}>`,
      "-quality", "90",
      dest,
    ]);
    const out = await stat(dest);
    const rel = `/${path.relative(root, job.file).split(path.sep).join("/")}`;
    if (out.size >= job.info.size) {
      await unlink(dest);
      continue;
    }
    variantBytes += out.size;
    kept += 1;
    manifest.images[rel] = { widths: [job.width], formats: ["webp"] };
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

manifest.sourceBytes = sourceBytes;
manifest.variantBytes = variantBytes;
manifest.sourceCount = files.length;
manifest.variantCount = kept;
manifest.covered = Object.keys(manifest.images).length;
manifest.quality = "webp-90-native";

await writeFile(path.resolve("src/lib/menuImageManifest.json"), `${JSON.stringify(manifest)}\n`);
console.log(JSON.stringify({
  sourceCount: files.length,
  heavy: queue.length,
  kept,
  variantBytes,
  covered: manifest.covered,
}, null, 2));
