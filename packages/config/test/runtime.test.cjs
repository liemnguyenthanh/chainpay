const assert = require('node:assert/strict');
const test = require('node:test');
const { parseRuntimeConfig } = require('../dist/index.js');

test('provides local startup defaults', () => {
  assert.deepEqual(parseRuntimeConfig({}), {
    nodeEnv: 'development',
    apiPort: 3001,
  });
});

test('accepts supported environments and valid port boundaries', () => {
  for (const nodeEnv of ['development', 'test', 'production']) {
    for (const apiPort of [1, 3001, 65535]) {
      assert.deepEqual(
        parseRuntimeConfig({ NODE_ENV: nodeEnv, API_PORT: String(apiPort) }),
        {
          nodeEnv,
          apiPort,
        },
      );
    }
  }
});

test('rejects malformed and out-of-range ports', () => {
  for (const value of [
    '',
    ' ',
    '0',
    '-1',
    '65536',
    '3.14',
    '1e3',
    '3001junk',
    'Infinity',
  ]) {
    assert.throws(() => parseRuntimeConfig({ API_PORT: value }), /API_PORT/);
  }
});

test('rejects unsupported environments without echoing supplied values', () => {
  assert.throws(
    () => parseRuntimeConfig({ NODE_ENV: 'sensitive-value' }),
    (error) => {
      assert.match(error.message, /NODE_ENV/);
      assert.doesNotMatch(error.message, /sensitive-value/);
      return true;
    },
  );
});
