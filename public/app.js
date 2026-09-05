// --- English Quiz App with Teacher Admin & Scoring Board ---

// State
let quizzes = [];
let submissions = [];
let currentQuiz = null;
let currentView = 'student'; // 'student' or 'admin'
let currentAdminTab = 'scores'; // 'scores', 'quizzes', 'settings'
let isAdminAuthenticated = false;
let adminCredential = '';
let submissionRequestId = '';

const API = {
  async request(path, { method = 'GET', body, credential = adminCredential } = {}) {
    let response;
    try {
      response = await fetch(`/api/${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000)
      });
    } catch { throw new Error('אין חיבור לשרת. הנתונים לא נשמרו. בדקו את החיבור ונסו שוב.'); }
    let data;
    try { data = await response.json(); } catch { throw new Error('שרת הבחנים אינו זמין. יש לפנות למורה.'); }
    if (!response.ok) throw new Error(data.error || 'הפעולה נכשלה. נסו שוב.');
    return data;
  },
  getQuizzes() { return this.request('quizzes'); },
  async saveQuiz(quiz) { return (await this.request('quizzes', { method: 'POST', body: quiz })).quizzes; },
  async deleteQuiz(id) { return (await this.request(`quizzes/${encodeURIComponent(id)}`, { method: 'DELETE' })).quizzes; },
  getSubmissions() { return this.request('submissions'); },
  saveSubmission(submission) { return this.request('submissions', { method: 'POST', body: submission }); },
  async deleteSubmission(id) { await this.request(`submissions/${encodeURIComponent(id)}`, { method: 'DELETE' }); return this.getSubmissions(); }
};

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Helpers
function normalizeText(str) {
  if (!str) return '';
  return str.trim()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'״׳]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// --- HELPER TO FIND QUIZ ROBUSTLY ---
function findQuiz(param) {
  if (!param || !Array.isArray(quizzes) || quizzes.length === 0) return null;
  const pStr = String(param).trim().toLowerCase();

  // 1. Exact ID match (case-insensitive)
  let found = quizzes.find(q => String(q.id).toLowerCase() === pStr);
  if (found) return found;

  // 2. Match quizNumber property
  found = quizzes.find(q => String(q.quizNumber) === pStr);
  if (found) return found;

  return null;
}

function getCleanQuizUrl(quiz) {
  return `${window.location.origin}/?quiz=${encodeURIComponent(quiz.quizNumber || quiz.id)}`;
}

// --- INITIALIZATION ---
async function initApp() {
  try {
    quizzes = await API.getQuizzes();
    document.getElementById('connection-error').hidden = true;
    renderQuizCards();
  } catch (error) {
    document.getElementById('connection-error').hidden = false;
    document.getElementById('connection-error-text').textContent = error.message;
    renderLandingView();
    return;
  }

  // Check URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  let quizParam = urlParams.get('quiz') || urlParams.get('q');
  const viewParam = urlParams.get('view');

  // Also check hash: #quiz=... or #1
  if (!quizParam && window.location.hash) {
    const hash = window.location.hash.replace(/^#/, '');
    const hashParams = new URLSearchParams(hash);
    quizParam = hashParams.get('quiz') || hashParams.get('q');
    if (!quizParam && /^[a-zA-Z0-9_-]+$/.test(hash)) {
      quizParam = hash;
    }
  }

  // Also check pathname: /quiz/...
  if (!quizParam && window.location.pathname) {
    const match = window.location.pathname.match(/\/quiz\/([a-zA-Z0-9_-]+)/i);
    if (match) quizParam = match[1];
  }

  if (viewParam === 'admin' || (!quizParam && window.location.pathname.includes('/admin'))) {
    openAdminAuth();
  } else if (quizParam) {
    const quiz = findQuiz(quizParam);
    if (quiz) {
      currentQuiz = quiz;
      renderStudentView();
    } else {
      showToast(`בוחן "${quizParam}" לא נמצא. אנא בחר/י מהרשימה:`);
      renderLandingView();
      openQuizSelectModal();
    }
  } else {
    // Default to Mrs. Goldfryd landing page
    renderLandingView();
  }
}

// --- LANDING PAGE & NAVIGATION LOGIC ---
function renderLandingView() {
  renderQuizCards();
  currentView = 'landing';
  const landingEl = document.getElementById('landing-view');
  const studentEl = document.getElementById('student-view');
  const adminEl = document.getElementById('admin-view');

  if (landingEl) landingEl.style.display = 'block';
  if (studentEl) studentEl.style.display = 'none';
  if (adminEl) adminEl.style.display = 'none';

  // Update navigation items
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('sidebar-quizzes')?.classList.add('active');
  document.getElementById('tab-student-btn')?.classList.add('active');
  document.getElementById('tab-admin-btn')?.classList.remove('active');
}

function navigateToHome() {
  closeQuizSelectModal();
  document.getElementById('auth-modal')?.classList.remove('open');
  const url = new URL(window.location);
  url.searchParams.delete('quiz');
  url.searchParams.delete('view');
  url.hash = '';
  window.history.pushState({}, '', '/');
  renderLandingView();
}

function openQuizSelectModal() {
  const modal = document.getElementById('quiz-select-modal');
  const listContainer = document.getElementById('modal-quizzes-list');
  const input = document.getElementById('quiz-number-input');

  if (listContainer) {
    if (!quizzes || quizzes.length === 0) {
      listContainer.innerHTML = '<p style="color:#8c82a8; font-size:0.9rem; text-align:center;">לא נמצאו בחנים כרגע.</p>';
    } else {
      listContainer.innerHTML = quizzes.map((q, idx) => {
        const num = q.quizNumber || (idx + 1);
        const count = q.vocabulary ? q.vocabulary.length : 0;
        return `
          <div class="quiz-select-card" onclick="selectQuiz('${q.id}')">
            <div>
              <span class="quiz-badge-num">בוחן ${num}</span>
              <strong style="color: #fff; margin-right: 6px;">${escapeHTML(q.title)}</strong>
              <small style="color: #8c82a8; display: block; margin-top: 2px;">${count} מילים</small>
            </div>
            <button class="btn btn-sm btn-primary" style="padding: 6px 14px; font-size: 0.85rem;">
              התחל ←
            </button>
          </div>
        `;
      }).join('');
    }
  }

  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 150);
  }

  modal?.classList.add('open');
}

function closeQuizSelectModal() {
  document.getElementById('quiz-select-modal')?.classList.remove('open');
}

function goToQuizFromInput() {
  const input = document.getElementById('quiz-number-input');
  const val = input ? input.value.trim() : '';
  if (!val) {
    alert('אנא הזן/הזיני מספר בוחן.');
    input?.focus();
    return;
  }

  const quiz = findQuiz(val);
  if (!quiz) {
    alert(`לא נמצא בוחן עבור "${val}". אנא בדוק/בדקי את המספר או בחר/י מהרשימה.`);
    input?.focus();
    return;
  }

  selectQuiz(quiz.id);
}

function selectQuiz(quizId) {
  closeQuizSelectModal();
  const quiz = findQuiz(quizId);
  if (!quiz) return;

  currentQuiz = quiz;

  const url = new URL(window.location);
  url.pathname = '/';
  url.searchParams.delete('view');
  url.hash = '';
  url.searchParams.set('quiz', quiz.quizNumber || quiz.id);
  window.history.pushState({}, '', url);

  renderStudentView();
}

function sidebarNav(dest) {
  if (dest === 'admin' || dest === 'admin-settings') {
    openAdminAuth();
    if (isAdminAuthenticated && dest === 'admin-settings') {
      switchAdminTab('settings');
    }
  } else {
    navigateToHome();
  }
}

function switchScreen(screen) {
  if (screen === 'admin') {
    openAdminAuth();
  } else {
    navigateToHome();
  }
}

// --- STUDENT NAME GATE: one full name first, single submission per name ---
function isValidFullName(name) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (clean.length < 3 || clean.length > 60 || /[,;]/.test(clean)) return false;
  return clean.split(' ').filter(Boolean).length >= 2;
}

function updateNameGate() {
  const nameInput = document.getElementById('student-name');
  const error = document.getElementById('student-name-error');
  const ok = document.getElementById('student-name-ok');
  const card = document.getElementById('student-name-card');
  const questions = document.getElementById('questions-container');
  const label = document.getElementById('questions-step-label');
  const button = document.getElementById('submit-btn');
  if (!nameInput) return false;
  const value = nameInput.value.trim();
  const valid = isValidFullName(value);
  const touched = value.length > 0;
  if (error) {
    const showError = touched && !valid;
    error.hidden = !showError;
    if (showError) error.textContent = 'יש למלא שם מלא אחד — שם פרטי ושם משפחה (למשל: דניאל כהן).';
  }
  if (ok) ok.hidden = !valid;
  if (card) card.classList.toggle('is-valid', valid);
  if (questions) questions.classList.toggle('locked', !valid);
  if (label) label.classList.toggle('locked', !valid);
  [...document.querySelectorAll('.question-input')].forEach(input => { input.disabled = !valid || input.dataset.submitted === '1'; });
  if (button && button.dataset.submitted !== '1') {
    button.disabled = !valid;
    if (!valid) button.textContent = 'קודם ממלאים שם מלא למעלה ←';
    else if (button.textContent.includes('קודם')) button.textContent = 'הגש בוחן';
  }
  return valid;
}

// --- STUDENT VIEW LOGIC ---
function renderStudentView() {
  currentView = 'student';
  submissionRequestId = crypto.randomUUID();
  const landingEl = document.getElementById('landing-view');
  const studentEl = document.getElementById('student-view');
  const adminEl = document.getElementById('admin-view');

  if (landingEl) landingEl.style.display = 'none';
  if (studentEl) studentEl.style.display = 'block';
  if (adminEl) adminEl.style.display = 'none';

  if (!currentQuiz) {
    document.getElementById('quiz-title').innerText = 'אין בחנים זמינים כרגע';
    document.getElementById('questions-container').innerHTML = '<p style="text-align:center;">המורה טרם יצר/ה בוחן פעיל.</p>';
    return;
  }

  document.getElementById('quiz-title').innerText = currentQuiz.title;
  document.getElementById('quiz-instructions').innerText = currentQuiz.instructions || 'הוראה: לתרגם לעברית';

  const badge = document.getElementById('quiz-number-badge');
  if (badge) {
    badge.innerText = `בוחן ${currentQuiz.quizNumber || 1}`;
    badge.style.display = 'inline-block';
  }

  // NOTE: Requirement 4 - inside the quiz, users cannot switch/filter quizzes. The selector box is removed.

  // Render Questions
  const container = document.getElementById('questions-container');
  container.innerHTML = '';

  currentQuiz.vocabulary.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'question-row';
    row.innerHTML = `
      <div class="question-num">${index + 1}.</div>
      <div class="question-word">${escapeHTML(item.word)}</div>
      <div class="question-input-wrapper">
        <input type="text" class="question-input" id="q-${index}" aria-label="${escapeHTML(item.word)}" placeholder="הכנס פירוש בעברית..." autocomplete="off">
        <div class="correct-answer-hint" id="hint-${index}" style="display:none;"></div>
      </div>
    `;
    container.appendChild(row);
  });

  // Reset results and submit button — name first, questions locked until valid
  const nameInput = document.getElementById('student-name');
  nameInput.value = '';
  nameInput.disabled = false;
  const submitButton = document.getElementById('submit-btn');
  submitButton.disabled = true;
  submitButton.dataset.submitted = '';
  submitButton.innerText = 'קודם ממלאים שם מלא למעלה ←';
  document.getElementById('result-area').style.display = 'none';
  document.getElementById('teacher-notification').style.display = 'none';
  updateNameGate();
  setTimeout(() => nameInput.focus({ preventScroll: false }), 100);
}

async function submitQuiz() {
  const nameInput = document.getElementById('student-name');
  const error = document.getElementById('student-name-error');
  const cleanName = nameInput.value.trim().replace(/\s+/g, ' ');
  if (!isValidFullName(cleanName)) {
    nameInput.value = cleanName;
    updateNameGate();
    if (error) { error.hidden = false; error.textContent = 'חובה למלא קודם שם מלא אחד (שם פרטי ושם משפחה) — רק אז אפשר להגיש.'; }
    showToast('חובה למלא קודם שם מלא (שם פרטי ושם משפחה).');
    nameInput.focus();
    document.getElementById('student-name-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  nameInput.value = cleanName;
  const button = document.getElementById('submit-btn');
  const inputs = [...document.querySelectorAll('.question-input')];
  button.disabled = true;
  button.textContent = 'שומר את הבוחן...';
  nameInput.disabled = true;
  inputs.forEach(input => input.disabled = true);
  try {
    const { submission } = await API.saveSubmission({ studentName: nameInput.value.trim(), quizId: currentQuiz.id,
      answers: inputs.map(input => input.value), requestId: submissionRequestId });
    submission.answers.forEach((answer, index) => {
      inputs[index].classList.add(answer.isCorrect ? 'correct' : 'incorrect');
      if (!answer.isCorrect) {
        const hint = document.getElementById(`hint-${index}`);
        hint.textContent = `תשובה נכונה: ${answer.expectedAnswers.join(' / ')}`;
        hint.style.display = 'block';
      }
    });
    const score = document.getElementById('score-value');
    score.textContent = `${submission.score} / 100`;
    score.className = `result-score ${submission.score >= 55 ? 'pass' : 'fail'}`;
    document.getElementById('score-text').textContent = `${submission.studentName}, ענית נכון על ${submission.correctCount} מתוך ${submission.total} שאלות.`;
    document.getElementById('result-area').style.display = 'block';
    document.getElementById('teacher-notification').style.display = 'block';
    button.dataset.submitted = '1';
    inputs.forEach(input => { input.dataset.submitted = '1'; });
    button.textContent = 'הבוחן הוגש בהצלחה!';
  } catch (error) {
    showToast(error.message);
    button.dataset.submitted = '';
    inputs.forEach(input => { input.dataset.submitted = ''; });
    const duplicate = /כבר הגיש/.test(error.message || '');
    if (duplicate && error) {
      const nameError = document.getElementById('student-name-error');
      if (nameError) { nameError.hidden = false; nameError.textContent = error.message; }
      nameInput.disabled = false;
      nameInput.focus();
      document.getElementById('student-name-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      nameInput.disabled = false;
    }
    updateNameGate();
    if (!duplicate) {
      button.disabled = false;
      button.textContent = 'נסה להגיש שוב';
    }
  }
}

// --- ADMIN / TEACHER PANEL LOGIC ---

function openAdminAuth() {
  if (isAdminAuthenticated) {
    renderAdminView();
  } else {
    document.getElementById('auth-modal').classList.add('open');
    document.getElementById('admin-pin-input').focus();
  }
}

async function verifyAdminPin() {
  const input = document.getElementById('admin-pin-input');
  const error = document.getElementById('auth-error');
  try {
    await API.request('auth', { method: 'POST', credential: input.value });
    adminCredential = input.value;
    quizzes = await API.getQuizzes();
    isAdminAuthenticated = true;
    currentAdminTab = 'quizzes';
    document.getElementById('auth-modal').classList.remove('open');
    input.value = '';
    error.textContent = '';
    renderAdminView();
  } catch (failure) { adminCredential = ''; error.textContent = failure.message; input.focus(); }
}

async function logoutAdmin() {
  isAdminAuthenticated = false;
  adminCredential = '';
  submissions = [];
  document.getElementById('submissions-table-body').replaceChildren();
  document.getElementById('detail-answers-list').replaceChildren();
  renderLeaderboard();
  quizzes = await API.getQuizzes();
  navigateToHome();
}

function renderAdminView() {
  currentView = 'admin';
  const landingEl = document.getElementById('landing-view');
  const studentEl = document.getElementById('student-view');
  const adminEl = document.getElementById('admin-view');

  if (landingEl) landingEl.style.display = 'none';
  if (studentEl) studentEl.style.display = 'none';
  if (adminEl) adminEl.style.display = 'block';

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.getElementById('sidebar-admin')?.classList.add('active');
  document.getElementById('tab-admin-btn')?.classList.add('active');
  document.getElementById('tab-student-btn')?.classList.remove('active');

  switchAdminTab(currentAdminTab);
}

function switchAdminTab(tabName) {
  currentAdminTab = tabName;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tabName}`).classList.add('active');

  document.getElementById('admin-scores-section').style.display = tabName === 'scores' ? 'block' : 'none';
  document.getElementById('admin-quizzes-section').style.display = tabName === 'quizzes' ? 'block' : 'none';
  document.getElementById('admin-settings-section').style.display = tabName === 'settings' ? 'block' : 'none';

  if (tabName === 'scores') loadScoresTab();
  if (tabName === 'quizzes') loadQuizzesTab();
  if (tabName === 'settings') loadSettingsTab();
}

// Admin Tab 1: Scores & Leaderboard
async function loadScoresTab() {
  submissions = await API.getSubmissions();
  
  // Calculate stats
  const total = submissions.length;
  const avg = total > 0 ? Math.round(submissions.reduce((acc, s) => acc + (s.score || 0), 0) / total) : 0;
  const passCount = submissions.filter(s => (s.score || 0) >= 55).length;
  const passRate = total > 0 ? Math.round((passCount / total) * 100) : 0;
  const topScore = total > 0 ? Math.max(...submissions.map(s => s.score || 0)) : 0;

  document.getElementById('stat-total-subs').innerText = total;
  document.getElementById('stat-avg-score').innerText = avg;
  document.getElementById('stat-pass-rate').innerText = `${passRate}%`;
  document.getElementById('stat-top-score').innerText = topScore;

  // Populate Quiz Filter
  const filterSelect = document.getElementById('scores-quiz-filter');
  filterSelect.innerHTML = `<option value="">כל הבחנים (${quizzes.length})</option>` +
    quizzes.map(q => `<option value="${q.id}">${escapeHTML(q.title)}</option>`).join('');

  renderSubmissionsTable();
  renderLeaderboard();
}

function renderSubmissionsTable() {
  const searchQuery = normalizeText(document.getElementById('scores-search').value);
  const filterQuizId = document.getElementById('scores-quiz-filter').value;

  const filtered = submissions.filter(s => {
    const matchName = normalizeText(s.studentName).includes(searchQuery);
    const matchQuiz = !filterQuizId || s.quizId === filterQuizId;
    return matchName && matchQuiz;
  });

  const tbody = document.getElementById('submissions-table-body');
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color:#6b7280;">לא נמצאו הגשות התואמות לחיפוש.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(s => {
    const dateStr = s.submittedAt ? new Date(s.submittedAt).toLocaleString('he-IL') : '—';
    const isPass = (s.score || 0) >= 55;
    return `
      <tr>
        <td><strong>${escapeHTML(s.studentName)}</strong></td>
        <td>${escapeHTML(s.quizTitle || 'בוחן')}</td>
        <td>
          <span class="badge ${isPass ? 'badge-success' : 'badge-danger'}">
            ${s.score} / 100
          </span>
        </td>
        <td>${s.correctCount} / ${s.total}</td>
        <td style="font-size: 0.85rem; color: #64748b;">${dateStr}</td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="openSubmissionDetail('${s.id}')">פרטי תשובות</button>
          <button class="btn btn-sm btn-danger" style="margin-right: 4px;" onclick="removeSubmission('${s.id}')">מחק</button>
        </td>
      </tr>
    `;
  }).join('');
}

function openSubmissionDetail(subId) {
  const sub = submissions.find(s => s.id === subId);
  if (!sub) return;

  const modal = document.getElementById('detail-modal');
  document.getElementById('detail-student-name').innerText = sub.studentName;
  document.getElementById('detail-quiz-title').innerText = `${sub.quizTitle} — ציון: ${sub.score}/100`;

  const container = document.getElementById('detail-answers-list');
  if (!sub.answers || sub.answers.length === 0) {
    container.innerHTML = '<p>אין פירוט תשובות שמור עבור הגשה זו.</p>';
  } else {
    container.innerHTML = sub.answers.map((a, i) => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid #e2e8f0; background: ${a.isCorrect ? '#f0fdf4' : '#fef2f2'}; margin-bottom: 6px; border-radius: 6px;">
        <div>
          <span style="font-weight: bold; margin-left: 8px;">${i + 1}.</span>
          <span style="font-family: monospace; font-size: 1.1rem; color: #0f172a; direction: ltr; display: inline-block;">${escapeHTML(a.word)}</span>
        </div>
        <div style="text-align: left; direction: rtl;">
          <span>תשובת התלמיד: <strong>${escapeHTML(a.studentAnswer || '(ריק)')}</strong></span>
          ${!a.isCorrect ? `<br><small style="color:#b91c1c;">היה צריך: ${escapeHTML(a.expectedAnswers ? a.expectedAnswers.join(', ') : '')}</small>` : ''}
        </div>
        <div>
          <span class="badge ${a.isCorrect ? 'badge-success' : 'badge-danger'}">
            ${a.isCorrect ? '✓ נכון' : '✗ שגוי'}
          </span>
        </div>
      </div>
    `).join('');
  }

  modal.classList.add('open');
}

async function removeSubmission(id) {
  if (confirm('האם אתה בטוח שברצונך למחוק הגשה זו?')) {
    submissions = await API.deleteSubmission(id);
    loadScoresTab();
    showToast('ההגשה נמחקה בהצלחה.');
  }
}

function exportScoresCSV() {
  if (submissions.length === 0) {
    alert('אין נתונים לייצוא.');
    return;
  }

  let csv = '\uFEFF'; // UTF-8 BOM for Excel Hebrew support
  csv += 'שם התלמיד,שם הבוחן,ציון,תשובות נכונות,סה״כ שאלות,תאריך ושעה\n';

  submissions.forEach(s => {
    const name = `"${(s.studentName || '').replace(/"/g, '""')}"`;
    const title = `"${(s.quizTitle || '').replace(/"/g, '""')}"`;
    const score = s.score || 0;
    const correct = s.correctCount || 0;
    const total = s.total || 0;
    const date = `"${s.submittedAt ? new Date(s.submittedAt).toLocaleString('he-IL') : ''}"`;
    csv += `${name},${title},${score},${correct},${total},${date}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ציוני_בחנים_אנגלית_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('קובץ האקסל נוצר והורד למחשבך!');
}

// Admin Tab 2: Quizzes Manager
async function loadQuizzesTab() {
  quizzes = await API.getQuizzes();
  const listContainer = document.getElementById('quizzes-list');

  listContainer.innerHTML = quizzes.map((q, idx) => {
    const num = q.quizNumber || (idx + 1);
    const wordCount = q.vocabulary ? q.vocabulary.length : 0;
    const shareUrl = getCleanQuizUrl(q);
    return `
      <div class="quiz-item-card">
        <div class="quiz-item-details">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="quiz-badge-num">בוחן ${num}</span>
            <h3 style="margin: 0;">${escapeHTML(q.title)}</h3>
          </div>
          <p style="color: #8c82a8; font-size: 0.9rem; margin-top: 4px;">
            ${wordCount} מילים • ${escapeHTML(q.instructions || 'הוראה: לתרגם לעברית')} • קישור ישיר: <code style="color: #b76cff;">?quiz=${num}</code>
          </p>
        </div>
        <div class="quiz-actions">
          <button class="btn btn-sm btn-primary" onclick="copyQuizLink('${shareUrl}', ${num})">
            🔗 העתק קישור ישיר לתלמידים
          </button>
          <button class="btn btn-sm btn-whatsapp" onclick="shareQuizViaWhatsApp('${shareUrl}', '${escapeHTML(q.title).replace(/'/g, "\\'")}', ${num})" aria-label="שתף בוואטסאפ">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.44-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.5 0 1.47 1.07 2.89 1.22 3.09.15.2 2.11 3.22 5.1 4.51.71.31 1.27.49 1.71.63.72.23 1.37.2 1.88.12.57-.09 1.76-.72 2-1.42.25-.7.25-1.29.18-1.42-.08-.13-.28-.2-.57-.35zm-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.85 9.85 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.9-9.88a9.83 9.83 0 0 1 9.88 9.89c0 5.45-4.44 9.88-9.89 9.88zm8.42-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.9c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.9 11.9 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.9 0-3.18-1.24-6.16-3.47-8.42z"/></svg>
            שתף בוואטסאפ
          </button>
          <button class="btn btn-sm btn-outline" onclick="openEditQuizModal('${q.id}')">
            ✏️ ערוך
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteQuizConfirm('${q.id}')">
            🗑️ מחק
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function copyQuizLink(url, num) {
  navigator.clipboard.writeText(url).then(() => {
    showToast(`הקישור לבוחן ${num ? num : ''} הועתק! התלמיד ייכנס ישירות לבוחן.`);
  }).catch(() => {
    prompt('העתק את הקישור הישיר לתלמיד:', url);
  });
}

function shareQuizViaWhatsApp(url, title, num) {
  const text = `היי! מוזמנים לבוחן ${num ? num + ' ' : ''}״${title}״ באנגלית של Mrs. Goldfryd:\n${url}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

function openCreateQuizModal() {
  document.getElementById('quiz-modal-title').innerText = 'יצירת בוחן חדש';
  document.getElementById('edit-quiz-id').value = '';
  document.getElementById('edit-quiz-title').value = '';
  document.getElementById('edit-quiz-instructions').value = 'הוראה: לתרגם לעברית';
  document.getElementById('edit-words-container').innerHTML = '';
  addWordRowToModal('', '');
  addWordRowToModal('', '');
  addWordRowToModal('', '');
  document.getElementById('quiz-editor-modal').classList.add('open');
}

function openEditQuizModal(quizId) {
  const quiz = quizzes.find(q => q.id === quizId);
  if (!quiz) return;

  document.getElementById('quiz-modal-title').innerText = 'עריכת בוחן';
  document.getElementById('edit-quiz-id').value = quiz.id;
  document.getElementById('edit-quiz-title').value = quiz.title;
  document.getElementById('edit-quiz-instructions').value = quiz.instructions || 'הוראה: לתרגם לעברית';

  const container = document.getElementById('edit-words-container');
  container.innerHTML = '';
  (quiz.vocabulary || []).forEach(item => {
    addWordRowToModal(item.word, item.answers.join(', '));
  });

  document.getElementById('quiz-editor-modal').classList.add('open');
}

function addWordRowToModal(word = '', answers = '') {
  const container = document.getElementById('edit-words-container');
  const row = document.createElement('div');
  row.className = 'word-edit-row';
  row.style.display = 'flex';
  row.style.gap = '8px';
  row.style.marginBottom = '8px';
  row.innerHTML = `
    <input type="text" class="form-control word-eng" aria-label="מילה באנגלית" placeholder="מילה באנגלית (למשל: arrive)" value="${escapeHTML(word)}" style="direction: ltr; flex: 1;">
    <input type="text" class="form-control word-heb" aria-label="תרגומים בעברית" placeholder="תרגומים בעברית מופרדים בפסיקים (למשל: להגיע, לבוא)" value="${escapeHTML(answers)}" style="flex: 2;">
    <button type="button" class="btn btn-sm btn-danger" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(row);
}

function parseBulkWords() {
  const bulkText = prompt('הדבק כאן רשימת מילים (כל שורה: מילה באנגלית = תרגום בעברית, למשל: arrive = להגיע):');
  if (!bulkText) return;

  const lines = bulkText.split('\n');
  lines.forEach(line => {
    line = line.trim();
    if (!line) return;
    let parts = line.split(/[=:-]/);
    if (parts.length >= 2) {
      const eng = parts[0].trim();
      const heb = parts.slice(1).join('=').trim();
      if (eng && heb) {
        addWordRowToModal(eng, heb);
      }
    }
  });
}

async function saveQuizFromModal() {
  const id = document.getElementById('edit-quiz-id').value;
  const title = document.getElementById('edit-quiz-title').value.trim();
  const instructions = document.getElementById('edit-quiz-instructions').value.trim();

  if (!title) {
    alert('אנא הזן כותרת לבוחן.');
    return;
  }

  const wordRows = document.querySelectorAll('.word-edit-row');
  const vocabulary = [];

  wordRows.forEach(row => {
    const eng = row.querySelector('.word-eng').value.trim();
    const heb = row.querySelector('.word-heb').value.trim();
    if (eng && heb) {
      const answersArray = heb.split(',').map(s => s.trim()).filter(Boolean);
      vocabulary.push({ word: eng, answers: answersArray });
    }
  });

  if (vocabulary.length === 0) {
    alert('יש להזין לפחות מילה אחת בבוחן.');
    return;
  }

  if ([...wordRows].some(row => Boolean(row.querySelector('.word-eng').value.trim()) !== Boolean(row.querySelector('.word-heb').value.trim()))) { showToast('יש למלא גם מילה וגם תרגום בכל שורה.'); return; }

  const payload = {
    id: id || undefined,
    title,
    instructions,
    vocabulary,
    active: true
  };

  const saveButton = document.getElementById('save-quiz-btn');
  saveButton.disabled = true;
  try { quizzes = await API.saveQuiz(payload); }
  catch (error) { showToast(error.message); return; }
  finally { saveButton.disabled = false; }
  document.getElementById('quiz-editor-modal').classList.remove('open');
  await loadQuizzesTab();
  renderQuizCards();
  showToast('הבוחן נשמר בהצלחה!');
}

async function deleteQuizConfirm(id) {
  if (confirm('האם אתה בטוח שברצונך למחוק בוחן זה?')) {
    quizzes = await API.deleteQuiz(id);
    loadQuizzesTab();
    showToast('הבוחן נמחק בהצלחה.');
  }
}

// Admin Tab 3: Settings and backups
function loadSettingsTab() {

  const geminiInput = document.getElementById('gemini-api-key');
  if (geminiInput) {
    geminiInput.value = localStorage.getItem('gemini_api_key') || '';
  }
}

function saveGeminiApiKey() {
  const key = document.getElementById('gemini-api-key').value.trim();
  localStorage.setItem('gemini_api_key', key);
  showToast('מפתח Gemini API נשמר בהצלחה!');
}

async function exportDatabaseJSON() {
  submissions = await API.getSubmissions();
  quizzes = await API.getQuizzes();
  const data = {
    quizzes,
    submissions,
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `גיבוי_בחנים_מלא_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  showToast('קובץ הגיבוי נוצר בהצלחה!');
}

// --- WHITEBOARD AI SCANNER & PREVIEW/APPROVAL ---
let selectedWhiteboardDataUrl = null;

function openWhiteboardScannerModal() {
  resetScannerModal();
  document.getElementById('scanner-modal').classList.add('open');
}

function closeScannerModal() {
  document.getElementById('scanner-modal').classList.remove('open');
}

function resetScannerModal() {
  selectedWhiteboardDataUrl = null;
  document.getElementById('scanner-upload-step').style.display = 'block';
  document.getElementById('scanner-approval-step').style.display = 'none';
  document.getElementById('scanner-loading').style.display = 'none';
  document.getElementById('scanner-image-preview-area').style.display = 'none';
  document.getElementById('scanner-analyze-btn').style.display = 'inline-block';
  document.getElementById('scanner-preview-img').src = '';
  document.getElementById('scanner-words-table-body').innerHTML = '';
}

function handleImageSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    selectedWhiteboardDataUrl = e.target.result;
    document.getElementById('scanner-preview-img').src = selectedWhiteboardDataUrl;
    document.getElementById('scanner-source-img-small').src = selectedWhiteboardDataUrl;
    document.getElementById('scanner-image-preview-area').style.display = 'block';
    document.getElementById('scanner-analyze-btn').style.display = 'inline-block';
  };
  reader.readAsDataURL(file);
}

function togglePreviewImage() {
  const container = document.getElementById('collapsible-source-image');
  container.style.display = container.style.display === 'none' ? 'block' : 'none';
}

async function analyzeWhiteboardImage() {
  if (!selectedWhiteboardDataUrl) {
    alert('אנא בחר תמונה תחילה.');
    return;
  }

  document.getElementById('scanner-analyze-btn').style.display = 'none';
  document.getElementById('scanner-loading').style.display = 'block';

  const apiKey = localStorage.getItem('gemini_api_key');
  let extractedQuiz = null;

  // If user entered a Gemini API key, call Gemini Vision directly
  if (apiKey) {
    try {
      // Extract base64
      let base64Data = selectedWhiteboardDataUrl;
      if (base64Data.startsWith('data:')) {
        base64Data = base64Data.split(',')[1];
      } else {
        // Fetch image as blob then base64 if it's a relative URL like sample_whiteboard.jpg
        const imgRes = await fetch(selectedWhiteboardDataUrl);
        const blob = await imgRes.blob();
        base64Data = await new Promise((res) => {
          const r = new FileReader();
          r.onload = () => res(r.result.split(',')[1]);
          r.readAsDataURL(blob);
        });
      }

      const prompt = `You are an expert English teacher assistant. Look at this whiteboard image.
It contains an English vocabulary quiz with English words and their Hebrew translations.
Extract all vocabulary words and their accepted Hebrew translations written on the board.
Return ONLY a valid JSON object matching this schema, without markdown backticks:
{
  "title": "Quiz no. 1 - 9/9/26",
  "instructions": "הוראה: לתרגם לעברית",
  "vocabulary": [
    { "word": "arrive", "answers": ["להגיע"] }
  ]
}`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: selectedWhiteboardDataUrl.match(/^data:([^;]+)/)?.[1] || 'image/jpeg', data: base64Data } }
            ]
          }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      if (res.ok) {
        const json = await res.json();
        const text = json.candidates[0].content.parts[0].text;
        extractedQuiz = JSON.parse(text);
      }
    } catch (err) {
      console.warn('Image reading failed');
    }
  }

  if (!extractedQuiz || !Array.isArray(extractedQuiz.vocabulary) || !extractedQuiz.vocabulary.length || extractedQuiz.vocabulary.some(item => typeof item.word !== 'string' || !Array.isArray(item.answers) || item.answers.some(a => typeof a !== 'string'))) {
    document.getElementById('scanner-loading').style.display = 'none';
    document.getElementById('scanner-analyze-btn').style.display = 'inline-block';
    showToast('לא ניתן לקרוא את התמונה. בדקו את מפתח הסריקה או צרו בוחן ידנית.');
    return;
  }

  // Populate Step 2: Teacher Preview & Approval
  document.getElementById('scanner-loading').style.display = 'none';
  document.getElementById('scanner-upload-step').style.display = 'none';
  document.getElementById('scanner-approval-step').style.display = 'block';

  document.getElementById('scanner-quiz-title').value = extractedQuiz.title || 'בוחן אוצר מילים מהלוח';
  document.getElementById('scanner-quiz-instructions').value = extractedQuiz.instructions || 'הוראה: לתרגם לעברית';

  const tbody = document.getElementById('scanner-words-table-body');
  tbody.innerHTML = '';

  (extractedQuiz.vocabulary || []).forEach((item, idx) => {
    addScannerWordRow(item.word, item.answers.join(', '));
  });

  updateScannerCount();
}

function updateScannerCount() {
  const rows = document.querySelectorAll('.scanner-word-row');
  document.getElementById('scanner-words-count').innerText = rows.length;
}

function addScannerWordRow(word = '', answers = '') {
  const tbody = document.getElementById('scanner-words-table-body');
  const index = tbody.children.length + 1;
  const tr = document.createElement('tr');
  tr.className = 'scanner-word-row';
  tr.innerHTML = `
    <td style="font-weight: bold; color: #64748b;">${index}</td>
    <td>
      <input type="text" class="form-control scanner-eng" value="${escapeHTML(word)}" placeholder="מילה באנגלית" style="direction: ltr; font-weight: 600;">
    </td>
    <td>
      <input type="text" class="form-control scanner-heb" value="${escapeHTML(answers)}" placeholder="תרגומים בעברית מופרדים בפסיקים">
    </td>
    <td style="text-align: center;">
      <button type="button" class="btn btn-sm btn-danger" onclick="this.closest('tr').remove(); updateScannerCount();">✕</button>
    </td>
  `;
  tbody.appendChild(tr);
  updateScannerCount();
}

async function approveAndSaveScannerQuiz() {
  const title = document.getElementById('scanner-quiz-title').value.trim();
  const instructions = document.getElementById('scanner-quiz-instructions').value.trim();

  if (!title) {
    alert('אנא הזן כותרת לבוחן.');
    return;
  }

  const rows = document.querySelectorAll('.scanner-word-row');
  const vocabulary = [];

  rows.forEach(r => {
    const eng = r.querySelector('.scanner-eng').value.trim();
    const heb = r.querySelector('.scanner-heb').value.trim();
    if (eng && heb) {
      const answersArr = heb.split(',').map(s => s.trim()).filter(Boolean);
      vocabulary.push({ word: eng, answers: answersArr });
    }
  });

  if (vocabulary.length === 0) {
    alert('יש להשאיר לפחות מילה אחת בבוחן.');
    return;
  }

  const newQuiz = {
    title,
    instructions,
    vocabulary,
    active: true,
    createdFromImage: true
  };

  quizzes = await API.saveQuiz(newQuiz);
  closeScannerModal();
  loadQuizzesTab();

  const latestQuiz = quizzes[quizzes.length - 1];
  const link = getCleanQuizUrl(latestQuiz);
  navigator.clipboard.writeText(link).catch(() => {});

  alert(`✓ הבוחן "${title}" אושר ונשמר בהצלחה!\nהקישור לתלמידים הועתק אוטומטית ללוח: \n${link}`);
}

function renderQuizCards() {
  const container = document.getElementById('landing-quiz-cards');
  container.replaceChildren();
  quizzes.filter(q => q.active !== false).forEach((q, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `peer-card ${index === 0 ? 'card-29-mar' : ''}`;
    button.innerHTML = `<span class="date-badge"><span class="date-num">${q.quizNumber}</span><span class="date-month">QUIZ</span></span>
      <span class="avatar-box vocabulary-icon" aria-hidden="true">Aa</span><span class="peer-name">${escapeHTML(q.title)}</span>
      <span class="peer-role">${q.vocabulary.length} מילים</span><span class="peer-loc">${escapeHTML(q.instructions)}</span><span class="card-pill-tag">פתיחת הבוחן ←</span>`;
    button.addEventListener('click', () => selectQuiz(q.id));
    container.appendChild(button);
  });
  const join = document.createElement('button');
  join.type = 'button';
  join.className = 'peer-card featured-card';
  join.innerHTML = '<span class="avatar-box vocabulary-icon" aria-hidden="true">#</span><span class="peer-name">יש לכם מספר בוחן?</span><span class="peer-role">הזינו את המספר שקיבלתם מהמורה</span><span class="card-pill-tag">כניסה לבוחן ←</span>';
  join.addEventListener('click', openQuizSelectModal);
  container.appendChild(join);
}

function renderLeaderboard() {
  const ranked = isAdminAuthenticated ? [...submissions].sort((a, b) => b.score - a.score).slice(0, 5) : [];
  for (let i = 1; i <= 3; i++) {
    document.getElementById(`podium-${i}-name`).textContent = ranked[i - 1]?.studentName || '—';
    document.getElementById(`podium-${i}-score`).textContent = ranked[i - 1] ? `${ranked[i - 1].score}%` : '—';
  }
  document.getElementById('leaderboard-list-body').innerHTML = ranked.length ? ranked.map((s, i) =>
    `<div class="list-row"><span>${i + 1}</span><span>${escapeHTML(s.studentName)}</span><strong>${s.score}%</strong></div>`).join('') :
    '<p class="leaderboard-empty">הציונים זמינים למורה לאחר הכניסה.<br>תלמידים יקבלו משוב בסיום הבוחן.</p>';
}

window.addEventListener('popstate', initApp);
window.addEventListener('unhandledrejection', event => { event.preventDefault(); showToast(event.reason?.message || 'הפעולה נכשלה. נסו שוב.'); });
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') document.querySelectorAll('.modal-backdrop.open').forEach(modal => modal.classList.remove('open'));
});

// Run app on load
window.addEventListener('DOMContentLoaded', () => { renderLeaderboard(); initApp(); });
