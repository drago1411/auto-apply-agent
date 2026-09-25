import fs from 'fs';
import { execSync } from 'child_process';

console.log('=== VS Code Migration to D:\\Programs ===\n');

// 1. Terminate Code.exe if running
console.log('Stopping running Code.exe instances...');
try {
  execSync('taskkill /F /IM Code.exe /T', { stdio: 'ignore' });
  console.log('Stopped Code.exe successfully.');
} catch {
  console.log('No Code.exe processes were running.');
}

try {
  execSync('taskkill /F /IM CodeSetup* /T', { stdio: 'ignore' });
} catch {}

const migrations = [
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
  }
];

for (const item of migrations) {
  console.log(`\nProcessing ${item.name}...`);

  if (!fs.existsSync(item.src)) {
    console.log(`[SKIP] Source ${item.src} does not exist.`);
    continue;
  }

  const isJunction = fs.lstatSync(item.src).isSymbolicLink();
  if (isJunction) {
    console.log(`[SKIP] ${item.src} is already a junction.`);
    continue;
  }

  // Ensure dest exists
  fs.mkdirSync(item.dest, { recursive: true });

  // Final quick delta sync
  console.log(`Syncing latest changes to ${item.dest}...`);
  try {
    execSync(`robocopy "${item.src}" "${item.dest}" /E /R:1 /W:1 /NP /NFL /NDL`, { stdio: 'inherit' });
  } catch (e) {
    // robocopy returns non-zero on success with files
  }

  // Verify dest has files
  const destFiles = fs.readdirSync(item.dest);
  if (destFiles.length === 0) {
    console.error(`[ERROR] Destination ${item.dest} is empty! Aborting removal of ${item.src}`);
    continue;
  }

  // Remove source on C:
  console.log(`Removing source on C: ${item.src}...`);
  let removed = false;
  try {
    execSync(`rmdir /S /Q "${item.src}"`, { stdio: 'inherit' });
    removed = true;
  } catch (err) {
    console.warn(`Direct rmdir failed: ${err.message}. Trying backup rename fallback...`);
    const backup = `${item.src}_migrated_${Date.now()}`;
    try {
      fs.renameSync(item.src, backup);
      removed = true;
      // asynchronously try to clean backup
      try { execSync(`rmdir /S /Q "${backup}"`, { stdio: 'ignore' }); } catch {}
    } catch (renameErr) {
      console.error(`Failed to move aside ${item.src}: ${renameErr.message}`);
      continue;
    }
  }

  // Create junction
  console.log(`Creating junction: ${item.src} -> ${item.dest}`);
  try {
    execSync(`cmd.exe /c mklink /J "${item.src}" "${item.dest}"`, { stdio: 'inherit' });
    console.log(`✅ ${item.name} successfully migrated and junction linked!`);
  } catch (err) {
    console.error(`Error creating junction: ${err.message}`);
  }
}

console.log('\n=== VS Code Migration Completed ===');
