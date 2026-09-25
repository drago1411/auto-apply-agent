import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const syncTasks = [
  {
    name: 'VS Code Extensions',
    src: 'C:\\Users\\Hareeshwar\\.vscode',
    dest: 'D:\\Programs\\VSCode\\.vscode'
  },
  {
    name: 'VS Code Application',
    src: 'C:\\Users\\Hareeshwar\\AppData\\Local\\Programs\\Microsoft VS Code',
    dest: 'D:\\Programs\\VSCode\\Microsoft VS Code'
  },
  {
    name: 'VS Code Roaming Data',
    src: 'C:\\Users\\Hareeshwar\\AppData\\Roaming\\Code',
    dest: 'D:\\Programs\\VSCode\\AppData_Roaming_Code'
  },
  {
    name: 'Antigravity IDE Application',
    src: 'C:\\Users\\Hareeshwar\\AppData\\Local\\Programs\\Antigravity IDE',
    dest: 'D:\\Programs\\Antigravity\\Antigravity IDE'
  },
  {
    name: 'Antigravity User Settings',
    src: 'C:\\Users\\Hareeshwar\\.antigravity-ide',
    dest: 'D:\\Programs\\Antigravity\\.antigravity-ide'
  },
  {
    name: 'Antigravity Roaming IDE',
    src: 'C:\\Users\\Hareeshwar\\AppData\\Roaming\\Antigravity IDE',
    dest: 'D:\\Programs\\Antigravity\\AppData_Roaming_Antigravity_IDE'
  },
  {
    name: 'Antigravity Brain & Configs',
    src: 'C:\\Users\\Hareeshwar\\.gemini',
    dest: 'D:\\Programs\\Antigravity\\.gemini'
  },
  {
    name: 'Antigravity Roaming Config',
    src: 'C:\\Users\\Hareeshwar\\AppData\\Roaming\\Antigravity',
    dest: 'D:\\Programs\\Antigravity\\AppData_Roaming_Antigravity'
  },
  {
    name: 'Codex Runtime Data',
    src: 'C:\\Users\\Hareeshwar\\.codex',
    dest: 'D:\\Programs\\.codex'
  }
];

console.log('Starting parallel/sequential mirror to D:\\Programs...\n');

for (const task of syncTasks) {
  if (!fs.existsSync(task.src)) {
    console.log(`[SKIP] ${task.name}: source not found (${task.src})`);
    continue;
  }
  
  try {
    const isJunction = fs.lstatSync(task.src).isSymbolicLink();
    if (isJunction) {
      console.log(`[SKIP] ${task.name}: source is already a junction/symlink.`);
      continue;
    }
  } catch {}

  console.log(`--------------------------------------------------`);
  console.log(`Mirroring: ${task.name}`);
  console.log(`Source:    ${task.src}`);
  console.log(`Dest:      ${task.dest}`);
  console.log(`--------------------------------------------------`);

  fs.mkdirSync(task.dest, { recursive: true });

  const startTime = Date.now();
  try {
    // /E: copy subdirectories including empty ones
    // /R:1 /W:1: retry once, wait 1 sec on in-use files
    // /NFL /NDL /NJH /NJS: quiet progress for faster IO
    execSync(`robocopy "${task.src}" "${task.dest}" /E /R:1 /W:1 /NP /NFL /NDL`, { stdio: 'inherit' });
  } catch (err) {
    // robocopy returns non-zero on normal copy (1 = files copied, 2 = extra files, 3 = both)
    console.log(`Robocopy completed (exit code: ${err.status})`);
  }
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[DONE] ${task.name} mirrored in ${durationSec}s\n`);
}

console.log('All mirroring tasks completed!');
