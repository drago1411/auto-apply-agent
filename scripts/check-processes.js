import { execSync } from 'child_process';

try {
  const output = execSync('tasklist', { encoding: 'utf8' });
  const lines = output.split('\n');
  const matched = lines.filter(l => /code|antigravity/i.test(l));
  console.log('Matched processes:\n' + matched.join('\n'));
} catch (e) {
  console.error(e.message);
}
