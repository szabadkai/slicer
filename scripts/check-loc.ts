import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const MAX_LOC = 600;
const MAIN_MAX_LOC = 100;
const SRC_DIR = join(import.meta.dirname, '..', 'src');

interface Violation {
  file: string;
  lines: number;
  limit: number;
}

function countLines(filePath: string): number {
  const content = readFileSync(filePath, 'utf-8');
  return content.split('\n').length;
}

function walkDir(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = walkDir(SRC_DIR, ['.ts', '.js']);
const violations: Violation[] = [];

for (const file of files) {
  const lines = countLines(file);
  const rel = relative(join(SRC_DIR, '..'), file);
  const isMain = rel === 'src/main.ts' || rel === 'src/main.js';
  const limit = isMain ? MAIN_MAX_LOC : MAX_LOC;

  if (lines > limit) {
    violations.push({ file: rel, lines, limit });
  }
}

if (violations.length > 0) {
  console.error('\n❌ LOC limit violations:\n');
  for (const v of violations) {
    console.error(`  ${v.file}: ${v.lines} lines (limit: ${v.limit})`);
  }
  console.error(`\nMax ${MAX_LOC} lines per file, ${MAIN_MAX_LOC} for main.ts\n`);
  process.exit(1);
} else {
  console.error(`✅ All ${files.length} source files within LOC limits`);
}
