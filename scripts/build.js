const { mkdirSync, rmSync, copyFileSync, cpSync } = require('node:fs');
const { join } = require('node:path');
const root = join(__dirname, '..');
rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(join(root, 'dist'));
// Never publish answer keys, submissions, or the legacy root quiz.
for (const name of ['index.html', 'app.js', 'style.css', 'favicon.png']) {
  copyFileSync(join(root, 'public', name), join(root, 'dist', name));
}
// Student avatar faces for the leaderboard picker.
cpSync(join(root, 'public', 'assets'), join(root, 'dist', 'assets'), { recursive: true });
console.log('Built dashboard in dist; server functions deploy separately through Netlify.');
// Verify the server bundle too, without including it in the public directory.
require('esbuild').buildSync({ entryPoints: [join(root, 'netlify/functions/api.mjs')], bundle: true, platform: 'node', format: 'esm', target: 'node22', write: false, logLevel: 'warning' });
console.log('Netlify function bundle verified.');
