/* eslint-disable @typescript-eslint/no-require-imports */
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const directory = mkdtempSync(join(tmpdir(), 'chainpay-browser-'));
const key = join(directory, 'key.pem');
const cert = join(directory, 'cert.pem');
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    key,
    '-out',
    cert,
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
  ],
  { stdio: 'ignore' },
);
const child = spawn(
  process.execPath,
  [
    require.resolve('next/dist/bin/next'),
    'dev',
    '--hostname',
    'localhost',
    '--port',
    '13100',
    '--experimental-https',
    '--experimental-https-key',
    key,
    '--experimental-https-cert',
    cert,
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, API_INTERNAL_ORIGIN: 'http://127.0.0.1:13101' },
  },
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => child.kill(signal));
child.on('exit', (code) => {
  rmSync(directory, { recursive: true, force: true });
  process.exit(code ?? 0);
});
