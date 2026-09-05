const http = require('http');

function postSubmission(data) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(data), 'utf8');
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/submissions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': payload.length
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function getSubmissions() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3000/api/submissions', res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

async function test() {
  console.log('--- Testing POST Submission ---');
  const result = await postSubmission({
    studentName: 'יוסי כהן',
    quizId: 'vocab-unit-1',
    quizTitle: 'בוחן אוצר מילים - יחידה 1',
    score: 92,
    correctCount: 23,
    total: 25,
    answers: [
      { word: 'arrive', studentAnswer: 'להגיע', isCorrect: true, expectedAnswers: ['להגיע'] },
      { word: 'appear', studentAnswer: 'להופיע', isCorrect: true, expectedAnswers: ['להופיע'] },
      { word: 'cook', studentAnswer: 'לאכול', isCorrect: false, expectedAnswers: ['לבשל'] }
    ]
  });
  console.log('Created Submission ID:', result.submission?.id);

  console.log('--- Testing GET Submissions ---');
  const list = await getSubmissions();
  console.log('Total submissions found:', list.length);
  list.forEach(s => {
    console.log(`- ${s.studentName} | ${s.quizTitle} | ${s.score}/100 (${s.correctCount}/${s.total})`);
  });
}

test().catch(console.error);
