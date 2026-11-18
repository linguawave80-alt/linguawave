#!/usr/bin/env node

/**
 * collect-code.js
 * ----------------
 * Drop this file into ANY project folder and run:
 *
 *   node collect-code.js
 *
 * First run  → scans all files in the same directory (recursively),
 *              creates  <folder-name>_code.txt  with every file's content.
 *
 * Next runs  → re-scans, diffs against what is already in the txt file,
 *              reports Added / Changed / Removed files, rewrites the txt.
 *
 * ─── Options (environment variables) ─────────────────────────────────────────
 *   OUTPUT_FILE   Override the output file name/path
 *                 default: <current-folder-name>_code.txt  (next to this script)
 *
 *   EXTENSIONS    Comma-separated list of file extensions to collect
 *                 default: all common code/config/doc extensions (see below)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

// ─── Configuration ────────────────────────────────────────────────────────────

const ROOT_DIR   = __dirname;
const SCRIPT     = path.basename(__filename);   // always excluded

// Default extensions to include
const DEFAULT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.kt', '.swift', '.go', '.rs',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb',
  '.html', '.css', '.scss', '.sass', '.less',
   '.yaml', '.yml', '.toml', '.ini',
  '.sh', '.bash', '.zsh', '.ps1', '.bat',
  '.sql', '.graphql', '.proto',
  '.md', '.mdx', '.txt',
  '.xml', '.env', '.example','.gradle', '.prisma'
]);

// Directories and files to always skip
const IGNORE_NAMES = new Set([
  'node_modules', '.git', '.svn', '.hg',
  'dist', 'build', '.next', 'out', 'coverage', '.turbo',
  '__pycache__', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  '.DS_Store', 'Thumbs.db',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml','.json',
]);

// ─── Resolve output path ──────────────────────────────────────────────────────

function resolveOutputPath() {
  if (process.env.OUTPUT_FILE) return path.resolve(process.env.OUTPUT_FILE);
  const folderName = path.basename(ROOT_DIR);
  return path.join(ROOT_DIR, `${folderName}_code.txt`);
}

const OUTPUT_PATH = resolveOutputPath();
const OUTPUT_NAME = path.basename(OUTPUT_PATH);   // excluded from scan

// ─── Decide whether to include a path ────────────────────────────────────────

function getExtensions() {
  if (process.env.EXTENSIONS) {
    return new Set(
      process.env.EXTENSIONS.split(',').map(e => e.trim().toLowerCase())
    );
  }
  return DEFAULT_EXTENSIONS;
}

const EXTENSIONS = getExtensions();

function include(name, isDir) {
  if (IGNORE_NAMES.has(name))     return false;
  if (name === SCRIPT)            return false;   // this script
  if (name === OUTPUT_NAME)       return false;   // output file
  if (isDir && name.startsWith('.')) return false; // hidden dirs

  if (!isDir) {
    const ext = path.extname(name).toLowerCase();
    if (!ext) return false;   // no extension → skip
    return EXTENSIONS.has(ext);
  }
  return true;
}

// ─── Collect files recursively ────────────────────────────────────────────────

function collectFiles(dir) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (include(e.name, true)) results.push(...collectFiles(full));
    } else if (e.isFile()) {
      if (include(e.name, false)) results.push(full);
    }
  }
  return results;
}

// ─── Format helpers ───────────────────────────────────────────────────────────

const SEP      = '='.repeat(72);
const FILE_TAG = 'FILE:';

/** Canonical block for one file */
function makeBlock(relPath, content) {
  return `${SEP}\n${FILE_TAG} ${relPath}\n${SEP}\n${content}\n\n`;
}

/** Output file header (timestamp outside the per-file blocks) */
function makeHeader(count, timestamp) {
  return (
    `${SEP}\n` +
    `COMBINED CODE FILE\n` +
    `Generated : ${timestamp}\n` +
    `Root      : ${ROOT_DIR}\n` +
    `Files     : ${count}\n` +
    `${SEP}\n\n`
  );
}

// ─── Parse existing output → map  relPath → content ──────────────────────────

/**
 * We split on the exact two-line marker:
 *   ========...
 *   FILE: <path>
 * so timestamp changes in the global header never affect the diff.
 */
function parseExisting(text) {
  const map   = {};
  // Split by separator + FILE: header pairs
  const parts = text.split(new RegExp(`${SEP}\\n${FILE_TAG} `));
  // parts[0] = global header (ignored)
  for (let i = 1; i < parts.length; i++) {
    const nl      = parts[i].indexOf('\n');
    const relPath = parts[i].slice(0, nl).trim();
    // after relPath line, skip the closing === line
    const body    = parts[i].slice(nl + 1).replace(new RegExp(`^${SEP}\\n`), '');
    // strip trailing blank lines
    map[relPath]  = body.replace(/\n+$/, '');
  }
  return map;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const timestamp = new Date().toISOString();

  console.log('\n📁 Root      :', ROOT_DIR);
  console.log('📄 Output    :', OUTPUT_PATH, '\n');

  // 1. Collect files on disk
  const filePaths = collectFiles(ROOT_DIR);
  const diskMap   = {};

  for (const fp of filePaths) {
    const rel = path.relative(ROOT_DIR, fp);
    try {
      diskMap[rel] = fs.readFileSync(fp, 'utf8').replace(/\n+$/, '');
    } catch (err) {
      diskMap[rel] = `[Could not read file: ${err.message}]`;
    }
  }

  const diskKeys = Object.keys(diskMap).sort();

  // 2. Load existing output (if any)
  const isNew      = !fs.existsSync(OUTPUT_PATH);
  const existingMap = {};

  if (!isNew) {
    const raw = fs.readFileSync(OUTPUT_PATH, 'utf8');
    Object.assign(existingMap, parseExisting(raw));
    console.log('🔍 Existing output found – diffing…\n');
  } else {
    console.log('✨ No existing output – creating fresh file…\n');
  }

  // 3. Diff
  const added   = diskKeys.filter(r => !(r in existingMap));
  const changed = diskKeys.filter(r => (r in existingMap) && diskMap[r] !== existingMap[r]);
  const removed = Object.keys(existingMap).filter(r => !(r in diskMap));

  // 4. Build & write output
  const blocks     = diskKeys.map(rel => makeBlock(rel, diskMap[rel]));
  const newContent = makeHeader(diskKeys.length, timestamp) + blocks.join('');

  fs.writeFileSync(OUTPUT_PATH, newContent, 'utf8');

  // 5. Console report
  const sizekb = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1);

  if (isNew) {
    console.log(`✅ Created: ${OUTPUT_NAME}`);
    console.log(`   Files  : ${diskKeys.length}`);
    console.log(`   Size   : ${sizekb} KB\n`);
    return;
  }

  const anyChange = added.length || changed.length || removed.length;
  if (!anyChange) {
    console.log('✅ No changes detected – output file is already up to date.');
  } else {
    console.log(`✅ Updated: ${OUTPUT_NAME}`);
    if (added.length) {
      console.log(`\n  ➕ Added (${added.length}):`);
      added.forEach(f => console.log(`     + ${f}`));
    }
    if (changed.length) {
      console.log(`\n  ✏️  Changed (${changed.length}):`);
      changed.forEach(f => console.log(`     ~ ${f}`));
    }
    if (removed.length) {
      console.log(`\n  ➖ Removed (${removed.length}):`);
      removed.forEach(f => console.log(`     - ${f}`));
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Files in output : ${diskKeys.length}`);
  console.log(`   Output size     : ${sizekb} KB\n`);
}

main();
