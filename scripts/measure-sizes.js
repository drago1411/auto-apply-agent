import fs from 'fs';
import path from 'path';

function getDirSize(dir) {
  let total = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      try {
        if (e.isDirectory()) {
          total += getDirSize(full);
        } else if (e.isFile()) {
          total += fs.statSync(full).size;
        }
      } catch {}
    }
  } catch {}
  return total;
}

const targets = [
  'C:\\Users\\Hareeshwar\\.gemini',
  'C:\\Users\\Hareeshwar\\.vscode',
  'C:\\Users\\Hareeshwar\\AppData\\Roaming\\Code',
  'C:\\Users\\Hareeshwar\\AppData\\Local\\Programs\\Microsoft VS Code',
  'C:\\Users\\Hareeshwar\\AppData\\Local\\ms-playwright',
  'C:\\Users\\Hareeshwar\\.npm',
  'C:\\Users\\Hareeshwar\\AppData\\Local\\npm-cache',
  'C:\\Users\\Hareeshwar\\.cache',
  'C:\\Users\\Hareeshwar\\AppData\\Roaming\\Antigravity',
  'C:\\Users\\Hareeshwar\\AppData\\Local\\Antigravity',
  'C:\\Users\\Hareeshwar\\AppData\\Local\\Programs\\Antigravity',
  'C:\\Users\\Hareeshwar\\AppData\\Local\\Programs\\antigravity-ide'
];

for (const t of targets) {
  if (fs.existsSync(t)) {
    const bytes = getDirSize(t);
    const mb = (bytes / (1024 * 1024)).toFixed(2);
    const gb = (bytes / (1024 * 1024 * 1024)).toFixed(2);
    console.log(`${t} -> ${mb} MB (${gb} GB)`);
  } else {
    console.log(`${t} -> NOT FOUND`);
  }
}
