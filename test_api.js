// Compatibility entry point. Tests use isolated temporary data, never a live class.
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, ['--test', 'tests/api.test.mjs'], { stdio: 'inherit' });
process.exitCode = result.status ?? 1;
