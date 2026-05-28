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

/** Поля класса — только с отступом в 2 пробела (не внутри объектов/методов). */
function isClassFieldLine(line) {
  if (!/^  \S/.test(line) || /^    /.test(line)) return false;

  const trimmed = line.trim();
  if (!trimmed || trimmed === '{' || trimmed === '}') return false;
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/**')) return false;
  if (trimmed.startsWith('@')) return false;
  if (/^(export\s+)?(default\s+)?(abstract\s+)?class\s/.test(trimmed)) return false;
  if (/^(public|private|protected)\s+(async\s+)?\w+\s*\([^)]*\)\s*(:|\{|$)/.test(trimmed)) {
    return false;
  }
  if (/^(async\s+)?\w+\s*\([^)]*\)\s*(:|{)/.test(trimmed) && !trimmed.includes('=')) return false;
  if (/^(get|set)\s+\w+/.test(trimmed)) return false;
  if (trimmed.startsWith('constructor(')) return false;
  if (/^(public|private|protected|readonly)\s/.test(trimmed)) return true;
  if (/^readonly\s/.test(trimmed)) return true;
  if (/^\w+\s*=\s*(input|output|viewChild|inject|signal|computed)/.test(trimmed)) return true;
  if (/^\w+\s*=\s*/.test(trimmed)) return true;
  if (/^\w+(\?)?\s*:\s*[^=]+$/.test(trimmed) && !trimmed.includes('(')) return true;
  return false;
}

function removeBlankLinesInsideNestedBlocks(content) {
  const lines = content.split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() !== '') {
      out.push(line);
      continue;
    }

    const prev = out[out.length - 1] ?? '';
    const next = lines[i + 1] ?? '';
    const prevIndent = prev.match(/^(\s*)/)?.[1].length ?? 0;
    const nextIndent = next.match(/^(\s*)/)?.[1].length ?? 0;

    if (prevIndent >= 4 && nextIndent >= 4) continue;
    if (prev.trim().endsWith('{') && nextIndent >= 4) continue;

    out.push(line);
  }

  return out.join('\n');
}

function formatFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  content = removeBlankLinesInsideNestedBlocks(content);

  const lines = content.split('\n');
  const out = [];
  let inClass = false;
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^(export\s+)?(default\s+)?(abstract\s+)?class\s/.test(trimmed)) {
      inClass = true;
      depth = 0;
    }

    if (inClass) {
      const open = (line.match(/{/g) || []).length;
      const close = (line.match(/}/g) || []).length;

      const prev = out[out.length - 1];
      const prevTrimmed = prev?.trim() ?? '';

      if (
        prev &&
        prevTrimmed !== '' &&
        isClassFieldLine(prev) &&
        isClassFieldLine(line) &&
        trimmed !== '}'
      ) {
        out.push('');
      }

      out.push(line);

      depth += open - close;
      if (depth <= 0 && close > 0) inClass = false;
    } else {
      out.push(line);
    }
  }

  const next = out.join('\n');
  fs.writeFileSync(filePath, next, 'utf8');
}

for (const file of walk(srcRoot)) {
  formatFile(file);
}

console.log('Done formatting class fields in', srcRoot);
