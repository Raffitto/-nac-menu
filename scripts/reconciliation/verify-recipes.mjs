import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const baseline = JSON.parse(fs.readFileSync(new URL('./recipe-preservation.json', import.meta.url), 'utf8'));
const directory = process.argv[2];
if (!directory) throw new Error('Supply the saved reconciliation evidence directory; no database connection is used.');
const errors = [];
for (const [filename, expected] of Object.entries(baseline)) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, filename))).digest('hex');
  if (actual !== expected) errors.push(filename);
}
const snapshot = JSON.parse(fs.readFileSync(path.join(directory, 'recipe_snapshot_readonly.json'), 'utf8'));
const counts = { recipes: snapshot.recipes.length, versions: snapshot.versions.length, lines: snapshot.lines.length };
if (counts.recipes !== 125 || counts.versions !== 188 || counts.lines !== 788) errors.push('record_counts');
console.log(JSON.stringify({ counts, unchanged: !errors.length, errors }, null, 2));
if (errors.length) process.exitCode = 1;
