import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
function run(exe, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {cwd, stdio: 'inherit'});
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Tests failed: ${code}`)));
  });
}
await run('go', ['test', './...'], root + 'server');
await run(process.execPath, [root + 'web/node_modules/vitest/vitest.mjs', 'run'], root + 'web');
