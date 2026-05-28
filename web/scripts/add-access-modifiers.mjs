import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function processFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  let inClass = false;
  let depth = 0;
  let changed = false;

  const out = lines.map((line) => {
    const trimmed = line.trim();

    if (/^(export\s+)?(default\s+)?(abstract\s+)?class\s/.test(trimmed)) {
      inClass = true;
      depth = 0;
    }

    if (!inClass) return line;

    const open = (line.match(/{/g) || []).length;
    const close = (line.match(/}/g) || []).length;
    depth += open - close;
    if (depth <= 0 && close > 0) inClass = false;

    if (!/^  \S/.test(line) || /^    /.test(line)) return line;
    if (/^\s+(public|private|protected)\s/.test(line)) return line;

    // fields
    if (/^  readonly /.test(line)) {
      changed = true;
      return line.replace(/^  readonly /, '  public readonly ');
    }
    if (/^  \w+ = input/.test(line) || /^  \w+ = output/.test(line)) {
      changed = true;
      return line.replace(/^  /, '  public readonly ');
    }
    if (/^  \w+ = computed/.test(line)) {
      changed = true;
      return line.replace(/^  /, '  public readonly ');
    }
    if (/^  \w+ = (formatRate|formatDuration)/.test(line)) {
      changed = true;
      return line.replace(/^  /, '  public readonly ');
    }

    if (
      /^  [a-zA-Z_][\w]*\s*\([^)]*\)\s*(:|{|$)/.test(line) &&
      !line.includes('=') &&
      !trimmed.startsWith('constructor(')
    ) {
      changed = true;
      return line.replace(/^  /, '  public ');
    }

    return line;
  });

  if (changed) fs.writeFileSync(filePath, out.join('\n'), 'utf8');
}

for (const file of walk(srcRoot)) {
  processFile(file);
}

console.log('Done adding access modifiers');
