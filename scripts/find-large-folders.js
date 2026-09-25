import fs from 'fs';
import path from 'path';

function getDirSize(dir, maxDepth = 2, currentDepth = 0) {
  let total = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      try {
        if (e.isDirectory()) {
          total += getDirSize(full, maxDepth, currentDepth + 1);
        } else if (e.isFile()) {
          total += fs.statSync(full).size;
        }
      } catch {}
    }
  } catch {}
  return total;
}

const checkPaths = [
  'C:\\Users\\Hareeshwar\\AppData\\Local',
  'C:\\Users\\Hareeshwar\\AppData\\Roaming',
  'C:\\Users\\Hareeshwar'
];

for (const p of checkPaths) {
  console.log(`\n=== Scanning top folders in ${p} ===`);
  try {
    const entries = fs.readdirSync(p, { withFileTypes: true });
    const results = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        const full = path.join(p, e.name);
        const bytes = getDirSize(full);
        const gb = (bytes / (1024 * 1024 * 1024)).toFixed(2);
        if (parseFloat(gb) > 0.3) {
          results.push({ path: full, gb: parseFloat(gb) });
        }
      }
    }
    results.sort((a, b) => b.gb - a.gb);
    for (const r of results) {
      console.log(`  ${r.gb} GB  ->  ${r.path}`);
    }
  } catch (err) {
    console.error(err.message);
  }
}
