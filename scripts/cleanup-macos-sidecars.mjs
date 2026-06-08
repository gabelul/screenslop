#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const yes = args.has('--yes') || args.has('-y');

const ignoredDirs = new Set([
  '.git',
  '.omc',
  'node_modules',
  'artifacts',
  'research/repos',
  'research/skills'
]);

/**
 * Returns true when a path is a macOS sidecar or metadata file.
 * @param {string} filePath Absolute file path.
 * @returns {boolean} Whether the file should be considered cleanup noise.
 */
function isMacOSNoise(filePath) {
  const base = path.basename(filePath);
  return base === '.DS_Store' || base.startsWith('._');
}

/**
 * Returns true when a relative path lives under an ignored directory.
 * @param {string} relativePath Path relative to the project root.
 * @returns {boolean} Whether traversal should skip this path.
 */
function shouldSkip(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  for (const ignored of ignoredDirs) {
    if (normalized === ignored || normalized.startsWith(`${ignored}/`)) return true;
  }
  return false;
}

/**
 * Recursively collects macOS sidecar files under a directory.
 * @param {string} dir Directory to scan.
 * @returns {string[]} Absolute paths to sidecar files.
 */
function collectSidecars(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs);
    if (shouldSkip(rel)) continue;

    if (entry.isDirectory()) {
      results.push(...collectSidecars(abs));
      continue;
    }

    if (entry.isFile() && isMacOSNoise(abs)) {
      results.push(abs);
    }
  }
  return results;
}

/**
 * Asks the user for confirmation before deleting files.
 * @param {string} prompt Prompt to show.
 * @returns {Promise<boolean>} True when the user confirmed.
 */
async function confirm(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

const sidecars = collectSidecars(root);

if (sidecars.length === 0) {
  console.log('No macOS sidecar files found. Suspiciously clean, but we take the win.');
  process.exit(0);
}

console.log(`Found ${sidecars.length} macOS sidecar file(s):`);
for (const file of sidecars) {
  console.log(`  ${path.relative(root, file)}`);
}

if (dryRun) {
  console.log('\nDry run only. Nothing deleted.');
  process.exit(0);
}

const allowed = yes || await confirm('\nDelete these files? [y/N] ');
if (!allowed) {
  console.log('Leaving files alone. Run with --yes if you want the boring cleanup robot to do it.');
  process.exit(0);
}

for (const file of sidecars) {
  fs.rmSync(file, { force: true });
}

console.log(`Deleted ${sidecars.length} macOS sidecar file(s).`);
