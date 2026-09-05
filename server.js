const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const QUIZZES_FILE = path.join(DATA_DIR, 'quizzes.json');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure data folder and files exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const content = fs.readFileSync(file, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`Error reading ${file}:`, err);
    return fallback;
  }
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    if (file === QUIZZES_FILE) {
      try {
        const pubQuiz = path.join(PUBLIC_DIR, 'quizzes.json');
        const pubDataDir = path.join(PUBLIC_DIR, 'data');
        if (!fs.existsSync(pubDataDir)) fs.mkdirSync(pubDataDir, { recursive: true });
        fs.writeFileSync(pubQuiz, JSON.stringify(data, null, 2), 'utf8');
        fs.writeFileSync(path.join(pubDataDir, 'quizzes.json'), JSON.stringify(data, null, 2), 'utf8');
      } catch (syncErr) {
        console.warn('Could not mirror quizzes to public dir:', syncErr);
      }
    }
    return true;
  } catch (err) {
    console.error(`Error writing ${file}:`, err);
    return false;
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) { // 1MB limit
        req.connection.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // --- API ROUTES ---

  // GET /api/quizzes
  if (pathname === '/api/quizzes' && req.method === 'GET') {
    const quizzes = readJSON(QUIZZES_FILE, []);
    return sendJSON(res, 200, quizzes);
  }

  // POST /api/quizzes (Create or Update Quiz)
  if (pathname === '/api/quizzes' && req.method === 'POST') {
    try {
      const quizData = await parseBody(req);
      if (!quizData.title || !Array.isArray(quizData.vocabulary) || quizData.vocabulary.length === 0) {
        return sendJSON(res, 400, { error: 'Invalid quiz payload. Title and vocabulary array are required.' });
      }

      let quizzes = readJSON(QUIZZES_FILE, []);
      if (quizData.id) {
        // Update existing
        const index = quizzes.findIndex(q => q.id === quizData.id);
        if (index !== -1) {
          quizzes[index] = { ...quizzes[index], ...quizData, updatedAt: new Date().toISOString() };
        } else {
          quizzes.push({ ...quizData, createdAt: new Date().toISOString() });
        }
      } else {
        // Create new
        const newQuiz = {
          ...quizData,
          id: quizData.id || ('quiz-' + Date.now()),
          quizNumber: quizData.quizNumber || (quizzes.length + 1),
          active: quizData.active !== undefined ? quizData.active : true,
          createdAt: new Date().toISOString()
        };
        quizzes.push(newQuiz);
      }

      writeJSON(QUIZZES_FILE, quizzes);
      return sendJSON(res, 200, { success: true, quizzes });
    } catch (err) {
      return sendJSON(res, 500, { error: err.message });
    }
  }

  // DELETE /api/quizzes/:id
  if (pathname.startsWith('/api/quizzes/') && req.method === 'DELETE') {
    const id = pathname.replace('/api/quizzes/', '');
    let quizzes = readJSON(QUIZZES_FILE, []);
    quizzes = quizzes.filter(q => q.id !== id);
    writeJSON(QUIZZES_FILE, quizzes);
    return sendJSON(res, 200, { success: true, quizzes });
  }

  // GET /api/submissions
  if (pathname === '/api/submissions' && req.method === 'GET') {
    const submissions = readJSON(SUBMISSIONS_FILE, []);
    return sendJSON(res, 200, submissions);
  }

  // POST /api/submissions (Student submits quiz)
  if (pathname === '/api/submissions' && req.method === 'POST') {
    try {
      const subData = await parseBody(req);
      if (!subData.studentName || !subData.quizId) {
        return sendJSON(res, 400, { error: 'Student name and quiz ID are required.' });
      }

      const submissions = readJSON(SUBMISSIONS_FILE, []);
      const newSubmission = {
        id: 'sub-' + Date.now(),
        studentName: subData.studentName.trim(),
        quizId: subData.quizId,
        quizTitle: subData.quizTitle || 'English Quiz',
        score: subData.score !== undefined ? subData.score : 0,
        correctCount: subData.correctCount || 0,
        total: subData.total || 0,
        answers: subData.answers || [],
        submittedAt: new Date().toISOString()
      };

      submissions.unshift(newSubmission); // newest first
      writeJSON(SUBMISSIONS_FILE, submissions);
      return sendJSON(res, 201, { success: true, submission: newSubmission });
    } catch (err) {
      return sendJSON(res, 500, { error: err.message });
    }
  }

  // DELETE /api/submissions/:id
  if (pathname.startsWith('/api/submissions/') && req.method === 'DELETE') {
    const id = pathname.replace('/api/submissions/', '');
    let submissions = readJSON(SUBMISSIONS_FILE, []);
    submissions = submissions.filter(s => s.id !== id);
    writeJSON(SUBMISSIONS_FILE, submissions);
    return sendJSON(res, 200, { success: true, submissions });
  }

  // GET /api/stats
  if (pathname === '/api/stats' && req.method === 'GET') {
    const quizzes = readJSON(QUIZZES_FILE, []);
    const submissions = readJSON(SUBMISSIONS_FILE, []);
    const totalSubmissions = submissions.length;
    const avgScore = totalSubmissions > 0
      ? Math.round(submissions.reduce((sum, s) => sum + (s.score || 0), 0) / totalSubmissions)
      : 0;
    const passCount = submissions.filter(s => (s.score || 0) >= 55).length;
    const passRate = totalSubmissions > 0 ? Math.round((passCount / totalSubmissions) * 100) : 0;

    return sendJSON(res, 200, {
      totalQuizzes: quizzes.length,
      totalSubmissions,
      avgScore,
      passRate
    });
  }

  // --- STATIC FILE SERVING ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' || pathname === '/admin' ? 'index.html' : pathname);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA-like navigation
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 Internal Server Error');
      } else {
        res.writeHead(200, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(content);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`Quiz server running on http://localhost:${PORT}`);
});
