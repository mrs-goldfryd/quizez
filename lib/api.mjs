import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const normalize = value => String(value || '').trim().replace(/[.,/#!$%^&*;:{}=\-_`~()?"'״׳]/g, '').replace(/\s+/g, ' ').toLowerCase();
const hash = value => createHash('sha256').update(value).digest();
const text = (value, max = 200) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

// Store contract matches Netlify Blobs. Conditional writes prevent teachers from
// overwriting each other's creates and keep quiz numbers stable after deletion.
export function createAPI({ store, seedQuizzes = [], seedSubmissions = [], adminPin }) {
  async function catalog() {
    const saved = await store.getWithMetadata('catalog', { type: 'json' });
    if (saved) return saved;
    const quizzes = seedQuizzes.map((q, i) => ({ ...q, quizNumber: q.quizNumber || i + 1 }));
    const data = { quizzes, nextNumber: Math.max(0, ...quizzes.map(q => q.quizNumber)) + 1 };
    await store.setJSON('catalog', data, { onlyIfNew: true });
    return store.getWithMetadata('catalog', { type: 'json' });
  }
  async function changeCatalog(change) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data, etag } = await catalog();
      change(data);
      if ((await store.setJSON('catalog', data, { onlyIfMatch: etag })).modified) return data.quizzes;
    }
    fail(409, 'הנתונים עודכנו במקביל. נסו לשמור שוב.');
  }
  async function body(request) {
    const raw = await request.text();
    if (raw.length > 100000) fail(413, 'הבקשה גדולה מדי.');
    try { return JSON.parse(raw); } catch { fail(400, 'בקשה לא תקינה.'); }
  }
  return async function handle(request) {
    try {
      const pathname = new URL(request.url).pathname.replace(/^\/\.netlify\/functions\/api/, '/api');
      const route = pathname.replace(/^\/api\/?/, '').split('/');
      const method = request.method;
      const credential = request.headers.get('authorization') || '';
      const isAdmin = Boolean(adminPin) && timingSafeEqual(hash(credential), hash(`Bearer ${adminPin}`));
      const protectedRoute = route[0] === 'auth' || (route[0] === 'quizzes' && method !== 'GET') || (route[0] === 'submissions' && method !== 'POST');
      if (protectedRoute) {
        if (!adminPin) fail(503, 'כניסת המורה טרם הוגדרה באתר. יש לפנות למנהל האתר.');
        if (!isAdmin) fail(401, 'קוד גישה שגוי.');
      }
      if (route[0] === 'auth' && method === 'POST') return json({ success: true });
      if (route[0] === 'quizzes') {
        if (method === 'GET' && !route[1]) {
          const { data } = await catalog();
          return json(isAdmin ? data.quizzes : data.quizzes.filter(q => q.active !== false).map(q => ({
            id: q.id, quizNumber: q.quizNumber, title: q.title, instructions: q.instructions,
            active: true, vocabulary: q.vocabulary.map(({ word }) => ({ word }))
          })));
        }
        if (method === 'POST' && !route[1]) {
          const quiz = await body(request);
          if (!quiz || !text(quiz.title) || !Array.isArray(quiz.vocabulary) || !quiz.vocabulary.length || quiz.vocabulary.length > 200 ||
            quiz.vocabulary.some(v => !v || !text(v.word) || !Array.isArray(v.answers) || !v.answers.length || v.answers.length > 20 || v.answers.some(a => !text(a)))) {
            fail(400, 'יש למלא כותרת, מילים ותרגומים תקינים.');
          }
          if (quiz.instructions !== undefined && typeof quiz.instructions !== 'string') fail(400, 'הוראות לא תקינות.');
          const fields = { title: quiz.title.trim(), instructions: (quiz.instructions || '').slice(0, 2000),
            active: quiz.active !== false, vocabulary: quiz.vocabulary.map(v => ({ word: v.word.trim(), answers: v.answers.map(a => a.trim()) })) };
          const id = quiz.id || `quiz-${randomUUID()}`;
          const quizzes = await changeCatalog(data => {
            if (quiz.id) {
              const index = data.quizzes.findIndex(q => q.id === quiz.id);
              if (index < 0) fail(404, 'הבוחן לא נמצא.');
              data.quizzes[index] = { ...data.quizzes[index], ...fields, updatedAt: new Date().toISOString() };
            } else {
              data.quizzes.push({ ...fields, id, quizNumber: data.nextNumber++, createdAt: new Date().toISOString() });
            }
          });
          return json({ success: true, quizzes });
        }
        if (method === 'DELETE' && route[1]) {
          const quizzes = await changeCatalog(data => { data.quizzes = data.quizzes.filter(q => q.id !== route[1]); });
          return json({ success: true, quizzes });
        }
      }
      if (route[0] === 'submissions') {
        if (method === 'POST' && !route[1]) {
          const input = await body(request);
          if (!input || !text(input.studentName) || !Array.isArray(input.answers)) fail(400, 'יש למלא שם ותשובות.');
          const { data } = await catalog();
          const quiz = data.quizzes.find(q => q.id === input.quizId && q.active !== false);
          if (!quiz) fail(404, 'הבוחן אינו זמין להגשה.');
          if (input.answers.length !== quiz.vocabulary.length || input.answers.some(a => typeof a !== 'string' || a.length > 1000)) fail(400, 'מספר התשובות או אורכן אינו תקין.');
          const answers = quiz.vocabulary.map((v, i) => ({ word: v.word, studentAnswer: input.answers[i].trim(),
            isCorrect: v.answers.some(a => normalize(a) === normalize(input.answers[i])), expectedAnswers: v.answers }));
          const correctCount = answers.filter(a => a.isCorrect).length;
          // A retry after a lost response keeps the same submission instead of duplicating it.
          const requestId = /^[a-zA-Z0-9-]{20,80}$/.test(input.requestId || '') ? input.requestId : randomUUID();
          const submission = { id: `sub-${requestId}`, studentName: input.studentName.trim(), quizId: quiz.id, quizTitle: quiz.title,
            score: Math.round(correctCount / answers.length * 100), correctCount, total: answers.length, answers, submittedAt: new Date().toISOString() };
          const key = `submissions/${submission.id}`;
          const { modified } = await store.setJSON(key, submission, { onlyIfNew: true });
          if (!modified) {
            const saved = await store.get(key, { type: 'json' });
            if (saved.studentName !== submission.studentName || saved.quizId !== submission.quizId || saved.answers.some((a, i) => a.studentAnswer !== answers[i]?.studentAnswer)) fail(409, 'מזהה ההגשה כבר בשימוש.');
            return json({ success: true, submission: saved });
          }
          return json({ success: true, submission }, 201);
        }
        if (method === 'GET' && !route[1]) {
          // Only local development imports the existing local submissions.
          if (seedSubmissions.length && !await store.get('submissions-imported')) {
            for (const sub of seedSubmissions) await store.setJSON(`submissions/${sub.id}`, sub, { onlyIfNew: true });
            await store.setJSON('submissions-imported', true);
          }
          const { blobs } = await store.list({ prefix: 'submissions/' });
          const submissions = (await Promise.all(blobs.map(b => store.get(b.key, { type: 'json' })))).filter(Boolean);
          return json(submissions.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)));
        }
        if (method === 'DELETE' && /^sub-[\w-]+$/.test(route[1] || '')) {
          await store.delete(`submissions/${route[1]}`);
          return json({ success: true });
        }
      }
      return json({ error: 'לא נמצא.' }, 404);
    } catch (error) {
      if (!error.status) console.error('Quiz API storage failure:', error.message);
      return json({ error: error.status ? error.message : 'לא ניתן לשמור או לטעון כרגע. נסו שוב.' }, error.status || 500);
    }
  };
}
