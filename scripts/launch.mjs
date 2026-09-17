import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {networkInterfaces} from 'node:os';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
async function freePort(initial) {
  for (let port = initial; port < initial + 100; port++) {
    const available = await new Promise(resolve => {
      const s = createServer(); s.once('error', () => resolve(false));
      s.listen(port, '0.0.0.0', () => s.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error('No available local port');
}
function command(executable, args, options) {
  return new Promise((resolve, reject) => {
    const p = spawn(executable, args, {stdio: 'inherit', ...options});
    p.on('error', reject); p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${executable} exited: ${code}`)));
  });
}
export async function launch(development) {
  const webPort = await freePort(Number(process.env.PORT || (development ? 5173 : 4173)));
  const apiPort = development ? await freePort(8080) : webPort;
  const addresses = Object.values(networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')).map(a => a.address);
  const origins = ['http://localhost:' + webPort, 'http://127.0.0.1:' + webPort, ...addresses.map(a => `http://${a}:${webPort}`)];
  const env = {...process.env, HTTP_ADDR: `0.0.0.0:${apiPort}`, COOKIE_SECURE: 'false',
    PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN || origins[0], ADDITIONAL_ORIGINS: origins.join(','),
    PINDOU_API_TARGET: `http://127.0.0.1:${apiPort}`};
  await mkdir(path.join(root, '.run'), {recursive: true});
  const bin = path.join(root, '.run', `pindou-server-${apiPort}` + (process.platform === 'win32' ? '.exe' : ''));
  if (!development) {
    await command(process.execPath, [path.join(root, 'web/node_modules/typescript/bin/tsc'), '--noEmit'], {cwd: path.join(root, 'web'), env});
    await command(process.execPath, [path.join(root, 'web/node_modules/vite/bin/vite.js'), 'build'], {cwd: path.join(root, 'web'), env});
  }
  await command('go', ['build', '-o', bin, './cmd/server'], {cwd: path.join(root, 'server'), env});
  const children = [spawn(bin, [], {cwd: path.join(root, 'server'), env, stdio: 'inherit'})];
  let stopping = false;
  function stop() { if (stopping) return; stopping = true; children.forEach(p => p.kill()); }
  for (const p of children) p.on('error', err => { console.error(err); stop(); process.exitCode = 1; });
  if (development) {
    const frontend = spawn(process.execPath, [path.join(root, 'web/node_modules/vite/bin/vite.js'), '--host', '0.0.0.0', '--port', String(webPort), '--strictPort'], {cwd: path.join(root, 'web'), env, stdio: 'inherit'});
    frontend.on('error', err => { console.error(err); stop(); process.exitCode = 1; }); children.push(frontend);
  }
  children.forEach(p => p.on('exit', code => { if (!stopping) { process.exitCode = code || 0; stop(); } }));
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  console.log(`\nLocal:   ${origins[0]}/`);
  addresses.forEach(a => console.log(`Network: http://${a}:${webPort}/`));
  console.log('Local HTTP mode only. Use HTTPS and Secure cookies for public deployment.\n');
}
