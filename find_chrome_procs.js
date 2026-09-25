import { execSync } from 'node:child_process';

const out = execSync('powershell -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object CommandLine -like \'*data\\chrome_profile*\' | Select-Object ProcessId, ExecutablePath, CommandLine | Format-List"', { encoding: 'utf-8' });
console.log(out);
