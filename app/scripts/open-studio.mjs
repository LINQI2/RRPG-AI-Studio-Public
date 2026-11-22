import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';

export async function ready(url) {
  const target = new URL('api/session', url);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') return false;
  // A direct socket must not inherit Node's optional environment proxy agent.
  return new Promise(resolve => {
    const req = http.get(target, { agent: new http.Agent(), timeout: 1500 }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; if (body.length > 65536) req.destroy(); });
      res.on('error', () => resolve(false));
      res.on('end', () => {
        try { const session = JSON.parse(body); resolve(res.statusCode === 200 && typeof session.csrf === 'string' && session.csrf.length > 0); }
        catch { resolve(false); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}
export function browserCommand(app, url, env = process.env, exists = fs.existsSync) {
  const target = new URL(url);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') throw Error('只允许打开本机工作台。');
  const candidates = [
    path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(env.ProgramFiles || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
  ];
  const executable = candidates.find(exists);
  if (!executable) throw Error(`未找到 Edge/Chrome，请在浏览器手动打开 ${url}，并将127.0.0.1设为代理例外；后台保持运行。`);
  // Dedicated profile keeps these proxy flags separate from the user's browser.
  return { executable, args: [`--user-data-dir=${path.join(app, 'runtime', 'studio-browser')}`,
    '--no-proxy-server', '--no-first-run', '--no-default-browser-check', '--new-window', url] };
}
export async function ensureStudio({ app, runtime, url, start, timeout = 30000 }) {
  if (await ready(url)) return 'already-running';
  const relative = path.relative(app, runtime);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw Error('运行目录必须位于 Studio app 内。');
  const lock = path.join(runtime, 'server.lock');
  if (fs.existsSync(lock)) {
    const { pid } = JSON.parse(fs.readFileSync(lock, 'utf8'));
    let alive = true;
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; else throw e; }
    if (alive) throw Error(`后台进程 ${pid} 仍在运行但网页未就绪，未重启或重复启动。请查看 app/runtime/server-error.log。`);
  }
  await start();
  const deadline = Date.now() + timeout;
  while (!(await ready(url))) {
    if (Date.now() >= deadline) throw Error('启动等待超时，请查看 app/runtime/server-error.log；没有关闭已有进程。');
    await delay(300);
  }
  return 'started';
}
async function main() {
  const app = fileURLToPath(new URL('../', import.meta.url));
  const runtime = path.resolve(process.env.STUDIO_RUNTIME || path.join(app, 'runtime'));
  const port = Number(process.env.STUDIO_PORT || 3178);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Studio 端口无效。');
  const url = `http://127.0.0.1:${port}/`;
  const result = await ensureStudio({ app, runtime, url, start: async () => {
    const entry = path.join(app, 'dist/server/main.js');
    if (!fs.existsSync(entry)) throw Error('缺少构建文件，请先在 app 运行 npm run build。');
    fs.mkdirSync(runtime, { recursive: true });
    const out = fs.openSync(path.join(runtime, 'server.log'), 'a');
    const err = fs.openSync(path.join(runtime, 'server-error.log'), 'a');
    try {
      const child = spawn(process.execPath, [entry], {
        cwd: app, env: process.env, detached: true, windowsHide: true, stdio: ['ignore', out, err],
      });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
    } finally { fs.closeSync(out); fs.closeSync(err); }
  } });
  console.log(result === 'started' ? '工作台已启动。' : '工作台已在运行，直接打开。');
  console.log(url);
  const command = browserCommand(app, url);
  const browser = spawn(command.executable, command.args, { detached: true, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { browser.once('spawn', resolve); browser.once('error', reject); });
  browser.unref();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
