import { spawn } from 'node:child_process';
const children = [];
let ending = false;
function stop(code = 0) {
  if (ending) return;
  ending = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
function launch(command, args, env = process.env) {
  const child = spawn(command, args, { stdio: 'inherit', env });
  children.push(child);
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code) => stop(code || 0));
  return child;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
launch('uv', ['run', '--locked', 'python', '-m', 'backend'], { ...process.env, PORT: '3001' });
const deadline = Date.now() + 180000;
while (!ending) {
  try {
    const response = await fetch('http://127.0.0.1:3001/api/health', { signal: AbortSignal.timeout(1000) });
    if (response.ok) {
      launch(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1']);
      break;
    }
  } catch {}
  if (Date.now() >= deadline) { console.error('Python API 시작 시간이 초과되었습니다.'); stop(1); break; }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
