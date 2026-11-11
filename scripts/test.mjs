import { spawn } from 'node:child_process';
const args = ['run', '--locked', 'python', '-m', 'pytest', '-q'];
const child = spawn('uv', args, { stdio: 'inherit', env: process.env });
child.on('error', (e) => { console.error(e.message); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
