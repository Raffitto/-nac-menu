#!/usr/bin/env node
/**
 * Build responsive WebP and AVIF variants for guest-menu photos.
 * Originals stay in place. A variant is kept only when it is smaller.
 */
import { spawn } from "child_process";
import { readdir, stat, writeFile, mkdir } from "fs/promises";
import path from "path";

const root = path.resolve("public");
const widths = [480, 960];
const concurrency = 4;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (/\.(jpe?g|png)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("magick", args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`magick ${code}`))));
  });
}

async function encode(src, dest, width, format) {
  const quality = format === "avif" ? "50" : "75";
  await run([
    src,
    "-auto-orient",
    "-resize", `${width}x${width}>`,
    "-strip",
    "-quality", quality,
    dest,
  ]);
}

const files = await walk(root);
const manifest = { images: {} };
let sourceBytes = 0;
let variantBytes = 0;
let kept = 0;
const queue = [];

for (const file of files) {
  const info = await stat(file);
  sourceBytes += info.size;
  const rel = `/${path.relative(root, file).split(path.sep).join("/")}`;
  const parsed = path.parse(file);
  const entry = { widths: [], formats: [] };
  for (const width of widths) {
    for (const format of ["webp", "avif"]) {
      queue.push({ file, rel, parsed, width, format, entry, original: info.size });
    }
  }
  manifest.images[rel] = entry;
}

let cursor = 0;
async function worker() {
  while (cursor < queue.length) {
    const job = queue[cursor];
    cursor += 1;
    const dest = path.join(job.parsed.dir, `${job.parsed.name}-${job.width}.${job.format}`);
    try {
      await encode(job.file, dest, job.width, job.format);
      const out = await stat(dest);
      if (out.size >= job.original) {
        const { unlink } = await import("fs/promises");
        await unlink(dest);
        continue;
      }
      variantBytes += out.size;
      kept += 1;
      if (!job.entry.widths.includes(job.width)) job.entry.widths.push(job.width);
      if (!job.entry.formats.includes(job.format)) job.entry.formats.push(job.format);
      job.entry.widths.sort((a, b) => a - b);
    } catch (err) {
      console.error("skip", job.rel, job.width, job.format, err.message);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

for (const [key, entry] of Object.entries(manifest.images)) {
  if (!entry.widths.length || !entry.formats.length) delete manifest.images[key];
}

manifest.sourceBytes = sourceBytes;
manifest.variantBytes = variantBytes;
manifest.sourceCount = files.length;
manifest.variantCount = kept;
manifest.covered = Object.keys(manifest.images).length;

await writeFile(path.resolve("src/lib/menuImageManifest.json"), `${JSON.stringify(manifest)}\n`);
console.log(JSON.stringify({
  sourceCount: files.length,
  sourceBytes,
  variantCount: kept,
  variantBytes,
  covered: manifest.covered,
}, null, 2));
