import fs from 'fs';
import { execSync } from 'child_process';

const operations = [
  {
    src: 'C:\\Users\\Hareeshwar\\.cache\\codex-runtimes',
    dest: 'D:\\Programs\\.cache\\codex-runtimes',
    name: 'Codex Runtimes Cache (1.31 GB)'
  },
  {
    src: 'C:\\Users\\Hareeshwar\\AppData\\Local\\ms-playwright',
    dest: 'D:\\Programs\\ms-playwright',
    name: 'Playwright Browsers Cache (0.7 GB)'
  }
];

for (const op of operations) {
  if (!fs.existsSync(op.src)) {
    console.log(`Skipping ${op.name}: source not found or already moved.`);
    continue;
  }
  const isJunction = fs.lstatSync(op.src).isSymbolicLink();
  if (isJunction) {
    console.log(`Skipping ${op.name}: source is already a junction/symlink.`);
    continue;
  }

  console.log(`\n==============================================`);
  console.log(`Moving ${op.name}...`);
  console.log(`From: ${op.src}`);
  console.log(`To:   ${op.dest}`);
  console.log(`==============================================`);

  fs.mkdirSync(op.dest, { recursive: true });

  try {
    // Robocopy moves files and subfolders
    execSync(`robocopy "${op.src}" "${op.dest}" /E /MOVE /R:1 /W:1`, { stdio: 'inherit' });
  } catch (err) {
    // robocopy returns exit code 1 on success (files copied)
    console.log(`Robocopy status: exit code ${err.status}`);
  }

  // Remove leftover empty source dir if still exists
  try {
    if (fs.existsSync(op.src)) {
      fs.rmSync(op.src, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`Warning removing empty source dir: ${err.message}`);
  }

  // Create junction
  console.log(`Creating junction: ${op.src} -> ${op.dest}`);
  try {
    execSync(`cmd.exe /c mklink /J "${op.src}" "${op.dest}"`, { stdio: 'inherit' });
    console.log(`✅ ${op.name} successfully moved and linked to D:!`);
  } catch (err) {
    console.error(`Error creating junction for ${op.name}: ${err.message}`);
  }
}
