import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createAPI } from '../lib/api.mjs';
import { localStore } from '../lib/local-store.mjs';

const seed = [{ id: 'seed', quizNumber: 1, title: 'Vocabulary', active: true, vocabulary: [{ word: 'hello', answers: ['שלום'] }] }];
function setup(t, pin = 'test-secret') {
  const directory = mkdtempSync(join(tmpdir(), 'quiz-api-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const make = () => createAPI({ store: localStore(directory), seedQuizzes: structuredClone(seed), adminPin: pin });
  const call = async (path, method = 'GET', body, authorized = false, handler = make()) => {
    const response = await handler(new Request(`http://localhost/api/${path}`, {
      method, headers: { ...(authorized ? { Authorization: 'Bearer test-secret' } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }));
    return { status: response.status, data: await response.json() };
  };
  return { call, make };
}
const quiz = title => ({ title, instructions: 'Translate', vocabulary: [{ word: 'book', answers: ['ספר'] }] });

test('teacher creates a quiz, independent student submits, teacher sees durable server-graded result', async t => {
  const { call } = setup(t);
  const created = await call('quizzes', 'POST', quiz('New test'), true);
  assert.equal(created.status, 200);
  const saved = created.data.quizzes.at(-1);
  const student = await call('quizzes');
  assert.equal(student.data.at(-1).id, saved.id);
  assert.equal(student.data.at(-1).vocabulary[0].answers, undefined);
  const result = await call('submissions', 'POST', { quizId: saved.id, studentName: 'Test Student', answers: ['wrong'], score: 100, requestId: '12345678-1234-1234-1234-123456789012' });
  assert.equal(result.status, 201);
  assert.equal(result.data.submission.score, 0);
  assert.equal((await call('submissions', 'GET', undefined, true)).data[0].id, result.data.submission.id);
  const retry = await call('submissions', 'POST', { quizId: saved.id, studentName: 'Test Student', answers: ['wrong'], requestId: '12345678-1234-1234-1234-123456789012' });
  assert.equal(retry.status, 200);
  assert.equal((await call('submissions', 'GET', undefined, true)).data.length, 1);
});

test('teacher access is enforced server-side and missing configuration fails closed', async t => {
  const { call } = setup(t);
  for (const [path, method, payload] of [['submissions', 'GET'], ['quizzes', 'POST', quiz('Unauthorized')], ['quizzes/seed', 'DELETE'], ['submissions/sub-1', 'DELETE'], ['auth', 'POST']]) {
    assert.equal((await call(path, method, payload)).status, 401);
  }
  assert.equal((await call('auth', 'POST', undefined, true)).status, 200);
  // Default parameter is deliberately bypassed with an empty configured value.
  const disabled = setup(t, '');
  assert.equal((await disabled.call('auth', 'POST')).status, 503);
});

test('editing preserves numbers; deletion and empty catalogs never restore seeds', async t => {
  const { call } = setup(t);
  const created = await call('quizzes', 'POST', quiz('Second'), true);
  const second = created.data.quizzes.at(-1);
  await call('quizzes/seed', 'DELETE', undefined, true);
  const updated = await call('quizzes', 'POST', { ...quiz('Edited'), id: second.id }, true);
  assert.equal(updated.data.quizzes[0].quizNumber, 2);
  await call(`quizzes/${second.id}`, 'DELETE', undefined, true);
  assert.deepEqual((await call('quizzes')).data, []);
  const next = await call('quizzes', 'POST', quiz('Third'), true);
  assert.equal(next.data.quizzes[0].quizNumber, 3);
});

test('concurrent creates and submissions do not lose records', async t => {
  const { call } = setup(t);
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => call('quizzes', 'POST', quiz(`Quiz ${i}`), true)));
  assert.ok(results.every(r => r.status === 200));
  const list = (await call('quizzes')).data;
  assert.equal(list.length, 6);
  assert.equal(new Set(list.map(q => q.quizNumber)).size, 6);
  const submissions = await Promise.all(Array.from({ length: 10 }, (_, i) => call('submissions', 'POST', { studentName: `Student ${i}`, quizId: 'seed', answers: [' שלום! '] })));
  assert.ok(submissions.every(r => r.status === 201 && r.data.submission.score === 100));
  assert.equal((await call('submissions', 'GET', undefined, true)).data.length, 10);
});

test('invalid payloads, unavailable quizzes and failed writes never report success', async t => {
  const { call } = setup(t);
  assert.equal((await call('quizzes', 'POST', { title: 'Empty', vocabulary: [] }, true)).status, 400);
  assert.equal((await call('submissions', 'POST', { studentName: 'Student', quizId: 'seed', answers: [] })).status, 400);
  assert.equal((await call('submissions', 'POST', { studentName: 'Student', quizId: 'missing', answers: ['x'] })).status, 404);
  const broken = createAPI({ store: { getWithMetadata() { throw new Error('Simulated unavailable storage'); } }, adminPin: 'test-secret' });
  assert.equal((await call('quizzes', 'POST', quiz('Failure'), true, broken)).status, 500);
});

test('Netlify build publishes dashboard assets and excludes old root page and answer keys', () => {
  execFileSync(process.execPath, ['scripts/build.js']);
  const html = readFileSync('dist/index.html', 'utf8');
  assert.ok(html.includes('id="landing-view"'));
  assert.ok(html.includes('id="header-admin-btn"'));
  assert.ok(html.includes('id="save-quiz-btn"'));
  assert.deepEqual(readdirSync('dist').sort(), ['app.js', 'index.html', 'style.css']);
  assert.match(readFileSync('netlify.toml', 'utf8'), /publish = "dist"/);
});
