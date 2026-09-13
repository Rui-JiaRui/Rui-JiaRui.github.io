const app = document.querySelector('#app');
const DEMO_HINT = '专用账号：liurui · 密码：K180';

const state = {
  registry: null,
  papers: new Map(),
  session: JSON.parse(sessionStorage.getItem('law-session') || 'null'),
  attempt: null,
  timer: null,
  resultFilter: 'all',
  startingPaperIds: new Set(),
  selectPages: {},
  selectCategory: 'not_started'
};

/*
 * The static site can be used without a backend.  When __LAW_SUPABASE__ is
 * configured (see docs/supabase-setup.md), this repository transparently
 * mirrors attempts and annotations to the Supabase Edge Function.
 */
class CloudRepository {
  constructor(config = globalThis.__LAW_SUPABASE__ || {}) {
    this.config = config;
    this.token = null;
    this.baseUrl = String(config.functionsUrl || '').replace(/\/$/, '');
    if (!this.baseUrl && config.url) this.baseUrl = `${String(config.url).replace(/\/$/, '')}/functions/v1/law-api`;
  }

  get enabled() { return Boolean(this.baseUrl); }

  async request(path, options = {}, retries = 2) {
    if (!this.enabled) throw new Error('cloud-disabled');
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (this.config.anonKey) headers.apikey = this.config.anonKey;
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `cloud-${response.status}`);
        return payload;
      } catch (error) {
        lastError = error;
        if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  login(username, passwordHash) {
    return this.request('/auth/login', { method: 'POST', body: JSON.stringify({ username, passwordHash }) });
  }

  listAttempts(paperId) {
    return this.request(`/attempts?paperId=${encodeURIComponent(paperId)}`, { method: 'GET' }).then((payload) => payload.attempts || payload || []);
  }

  getAttempt(attemptId) {
    return this.request(`/attempts/${encodeURIComponent(attemptId)}`, { method: 'GET' }).then((payload) => payload.attempt || payload);
  }

  saveAttempt(attempt) {
    return this.request(`/attempts/${encodeURIComponent(attempt.id)}`, { method: 'PUT', body: JSON.stringify({ attempt }) }).then((payload) => payload.attempt || payload);
  }

  submitAttempt(attempt) {
    return this.request(`/attempts/${encodeURIComponent(attempt.id)}/submit`, { method: 'POST', body: JSON.stringify({ attempt }) }).then((payload) => payload.attempt || payload);
  }

  listAnnotations(attemptId) {
    return this.request(`/attempts/${encodeURIComponent(attemptId)}/annotations`, { method: 'GET' }).then((payload) => payload.annotations || payload || []);
  }

  saveAnnotation(attemptId, questionId, content) {
    return this.request(`/attempts/${encodeURIComponent(attemptId)}/annotations/${encodeURIComponent(questionId)}`, {
      method: 'PUT',
      body: JSON.stringify({ content })
    });
  }
}

const cloudStore = new CloudRepository();
cloudStore.token = state.session?.token || null;

const dbStore = {
  db: null,
  async init() {
    if (!('indexedDB' in window)) return;
    await new Promise((resolve) => {
      const request = indexedDB.open('law-exam-store', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('attempts', { keyPath: 'id' });
      request.onsuccess = () => { this.db = request.result; resolve(); };
      request.onerror = () => resolve();
    });
  },
  async all() {
    if (!this.db) return JSON.parse(localStorage.getItem('law-attempts') || '[]');
    return new Promise((resolve) => {
      const req = this.db.transaction('attempts').objectStore('attempts').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  },
  async put(attempt) {
    if (!this.db) {
      const all = await this.all();
      const next = all.filter((item) => item.id !== attempt.id).concat(attempt);
      localStorage.setItem('law-attempts', JSON.stringify(next));
      return;
    }
    await new Promise((resolve) => {
      const req = this.db.transaction('attempts', 'readwrite').objectStore('attempts').put(attempt);
      req.onsuccess = req.onerror = () => resolve();
    });
  },
  async get(id) {
    if (!this.db) return (await this.all()).find((item) => item.id === id) || null;
    return new Promise((resolve) => {
      const req = this.db.transaction('attempts').objectStore('attempts').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }
};

const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const route = () => location.hash.replace(/^#\/?/, '') || 'login';
const navigate = (target) => { location.hash = `/${target}`; };
function typeLabel(type) {
  return ({ single: '单项选择', multiple: '多项选择', indefinite: '不定项选择', subjective: '主观题' }[type] || type);
}
const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const formatDate = (stamp) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(stamp));
const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function answerProvided(question, answer) {
  if (question?.type === 'subjective') return typeof answer === 'string' && answer.trim().length > 0;
  return Array.isArray(answer) && answer.length > 0;
}

function gradeAttempt(paper, answerKey, answers) {
  answers ||= {};
  const details = {};
  let score = 0;
  let total = 0;
  (paper.questions || []).forEach((question) => {
    const entry = answerKey?.answers?.[question.id] || {};
    if (question.type === 'subjective') {
      details[question.id] = {
        isSubjective: true,
        response: typeof answers[question.id] === 'string' ? answers[question.id] : '',
        referenceAnswer: entry.referenceAnswer || entry.answerText || '',
        analysis: entry.analysis || ''
      };
      return;
    }
    total += Number(question.score || 0);
    const correct = Array.isArray(entry.answer) ? entry.answer : [];
    const selected = Array.isArray(answers[question.id]) ? answers[question.id] : [];
    const isCorrect = correct.length === selected.length && correct.every((item) => selected.includes(item));
    if (isCorrect) score += Number(question.score || 0);
    details[question.id] = { selected, correct, isCorrect, analysis: entry.analysis || '' };
  });
  return { score, total, details, version: answerKey?.version || '1.0' };
}

function versionedURL(resourcePath) {
  const version = globalThis.__LAW_ASSET_VERSION__ || Date.now().toString(36);
  const separator = resourcePath.includes('?') ? '&' : '?';
  return `${resourcePath}${separator}v=${encodeURIComponent(version)}`;
}

function freshFetch(resourcePath) {
  return fetch(versionedURL(resourcePath), { cache: 'no-store' });
}

async function sha256(value) {
  if (!globalThis.crypto?.subtle) {
    if (value === 'K180') return 'd194b57af1169cc943ddb6cb4fa6aa4ae999bada1e0421e5c7101766d4f588f6';
    throw new Error('Web Crypto unavailable');
  }
  try {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    if (value === 'K180') return 'd194b57af1169cc943ddb6cb4fa6aa4ae999bada1e0421e5c7101766d4f588f6';
    throw error;
  }
}

async function loadPaper(paperId) {
  if (state.papers.has(paperId)) return state.papers.get(paperId);
  let paper;
  try {
    const response = await freshFetch(`data/exams/${encodeURIComponent(paperId)}/paper.json`);
    if (!response.ok) throw new Error('paper-load');
    paper = await response.json();
  } catch (error) {
    paper = globalThis.__LAW_DEMO__?.papers?.[paperId];
    if (!paper) throw error;
  }
  state.papers.set(paperId, paper);
  return paper;
}

async function findAttempts(paperId) {
  const localAll = await dbStore.all();
  const local = localAll.filter((item) => item.paperId === paperId && item.username === state.session?.username);
  if (cloudStore.enabled && state.session?.token) {
    try {
      const remote = await cloudStore.listAttempts(paperId);
      for (const attempt of remote) await dbStore.put({ ...attempt, syncState: 'synced' });
      const remoteIds = new Set(remote.map((item) => item.id));
      for (const attempt of local.filter((item) => !remoteIds.has(item.id))) {
        try {
          const uploaded = await cloudStore.saveAttempt(attempt);
          const index = local.findIndex((item) => item.id === attempt.id);
          if (index >= 0) local[index] = { ...attempt, ...uploaded, syncState: 'synced' };
          await dbStore.put(local[index]);
        } catch { /* retain the local copy for a later retry */ }
      }
      const merged = new Map();
      [...remote, ...local].forEach((item) => {
        const previous = merged.get(item.id);
        if (!previous || Number(item.updatedAt || 0) >= Number(previous.updatedAt || 0)) merged.set(item.id, item);
      });
      return [...merged.values()].sort((a, b) => b.startedAt - a.startedAt);
    } catch { /* offline: use the local mirror */ }
  }
  return local.sort((a, b) => b.startedAt - a.startedAt);
}

function createAttempt(paperId, paper, username, now = Date.now()) {
  const durationMinutes = Number(paper.paper?.durationMinutes || 0);
  return {
    id: uid(),
    username,
    paperId,
    paperVersion: paper.schemaVersion || '1.0',
    startedAt: now,
    expiresAt: now + durationMinutes * 60 * 1000,
    currentIndex: 0,
    answers: {},
    marked: [],
    annotations: {},
    status: 'in_progress',
    updatedAt: now,
    syncState: 'local'
  };
}

function attemptStatusLabel(attempt) {
  return ({
    in_progress: ['is-progress', '进行中'],
    graded: ['is-graded', '已批改'],
    submitted_ungraded: ['is-pending', '待批改'],
    abandoned: ['is-abandoned', '已放弃']
  }[attempt.status] || ['is-pending', attempt.status || '未知']);
}

function renderAttemptHistory(attempts, currentId) {
  if (!attempts.length) return '';
  const rows = attempts.map((item, index) => {
    const [statusClass, statusText] = attemptStatusLabel(item);
    const score = item.status === 'graded' && item.grading ? `${item.grading.score} / ${item.grading.total}` : statusText;
    return `<a class="history-row ${item.id === currentId ? 'is-current' : ''}" href="#/result/${encodeURIComponent(item.id)}"><span>第 ${attempts.length - index} 次 · ${formatDate(item.startedAt)}</span><span class="history-score">${escapeHTML(score)} <i class="status ${statusClass}">${statusText}</i></span></a>`;
  }).join('');
  return `<section class="attempt-history"><div class="section-subhead"><h2>历史记录</h2><span>${attempts.length} 次</span></div><div class="history-list">${rows}</div></section>`;
}

async function persist() {
  if (!state.attempt) return;
  state.attempt.updatedAt = Date.now();
  await dbStore.put(state.attempt);
  if (cloudStore.enabled && state.session?.token && !['submitted_ungraded', 'graded'].includes(state.attempt.status)) {
    try {
      const remote = await cloudStore.saveAttempt(state.attempt);
      state.attempt = { ...state.attempt, ...remote, syncState: 'synced' };
      await dbStore.put(state.attempt);
    } catch {
      state.attempt.syncState = 'pending';
      await dbStore.put(state.attempt);
    }
  }
}

function topbar(candidate = '') {
  return `<header class="topbar">
    <a class="brand" href="#/login" aria-label="返回首页"><span class="brand-mark">法</span><span class="brand-copy"><strong>法记</strong><span>LAW PRACTICE</span></span></a>
    ${candidate ? `<div class="topbar-meta"><span>${cloudStore.enabled && state.session?.token ? '云端同步' : '本地练习模式'}</span><span class="candidate-chip"><i class="avatar">${escapeHTML(candidate.slice(0, 1).toUpperCase())}</i>${escapeHTML(candidate)}</span></div>` : ''}
  </header>`;
}

function renderLogin(error = '') {
  stopTimer();
  state.session = null;
  cloudStore.token = null;
  sessionStorage.removeItem('law-session');
  app.innerHTML = `${topbar()}<main class="page login-layout">
    <section class="login-intro"><div class="eyebrow">司法考试 · 综合练习</div><h1>把每一次练习，<br>都变成可复盘的进步。</h1><div class="intro-rule"></div>
      <ul class="notice-list"><li>答卷支持云端同步，断网时自动暂存本机</li><li>支持单选、多选、不定项与主观题</li><li>交卷后查看得分、参考答案、解析与个人批注</li></ul>
    </section>
    <section class="login-card"><h2>进入练习</h2><p>使用分配的账号登录，系统会自动匹配可用试卷。</p>
      ${error ? `<div class="error" role="alert">${escapeHTML(error)}</div>` : ''}
      <form id="login-form"><div class="field"><label for="username">账号</label><input id="username" name="username" autocomplete="username" required autofocus></div>
      <div class="field"><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
      <button class="button button-primary" type="submit">验证并继续</button></form>
      <p class="helper">${DEMO_HINT}<br>${cloudStore.enabled ? '答卷将同步到云端；断网时暂存本机。' : '当前未配置云端，答卷仅保存在当前浏览器。'}</p>
    </section></main>`;
  document.querySelector('#login-form').addEventListener('submit', handleLogin);
}

async function handleLogin(event) {
  event.preventDefault();
  if (!state.registry?.accounts) { renderLogin('账号配置尚未加载，请刷新页面后重试。'); return; }
  const form = new FormData(event.currentTarget);
  const username = String(form.get('username')).trim();
  const passwordHash = `sha-256:${await sha256(String(form.get('password')))}`;
  let account = null;
  let token = null;
  if (cloudStore.enabled) {
    try {
      const remote = await cloudStore.login(username, passwordHash);
      token = remote.token || remote.accessToken;
      account = remote.user || remote.account || remote;
      if (!token || !account?.paperIds) throw new Error('invalid-login-response');
      cloudStore.token = token;
    } catch (error) {
      // Keep the static mode usable while offline; the next save will retry cloud sync.
      if (/cloud-401|invalid-credentials/.test(String(error.message || error))) {
        renderLogin('账号或密码不正确，请重新输入。');
        return;
      }
      account = state.registry.accounts.find((item) => item.enabled && item.username === username && item.passwordHash === passwordHash);
      if (!account) { renderLogin('账号或密码不正确，或云端暂时不可用。'); return; }
    }
  } else {
    account = state.registry.accounts.find((item) => item.enabled && item.username === username && item.passwordHash === passwordHash);
  }
  if (!account) { renderLogin('账号或密码不正确，请重新输入。'); return; }
  state.session = { username, paperIds: account.paperIds, token };
  sessionStorage.setItem('law-session', JSON.stringify(state.session));
  const target = account.paperIds.length > 1 ? 'select' : `exam/${account.paperIds[0]}`;
  navigate(target);
}

async function renderSelect() {
  stopTimer();
  const paperEntries = await Promise.all(state.session.paperIds.map(async (id) => [id, await loadPaper(id), await findAttempts(id)]));
  const groups = { not_started: [], in_progress: [], completed: [] };
  paperEntries.forEach((entry) => groups[paperCategory(entry[2])].push(entry));
  const categoryMeta = [
    ['not_started', '未完成', '尚未开始的试卷'],
    ['in_progress', '正在进行', '有答卷正在进行中'],
    ['completed', '已完成', '已有提交记录的试卷']
  ];
  if (!groups[state.selectCategory]) state.selectCategory = 'not_started';
  const tabs = categoryMeta.map(([key, title]) => `<button class="select-tab ${state.selectCategory === key ? 'is-active' : ''}" data-select-category="${key}" aria-selected="${state.selectCategory === key}">${title}<span>${groups[key].length}</span></button>`).join('');
  const selected = categoryMeta.find(([key]) => key === state.selectCategory);
  const section = renderPaperSection(...selected, groups[state.selectCategory]);
  const latestStats = aggregatePracticeStats(paperEntries);
  app.innerHTML = `${topbar(state.session.username)}<main class="page"><a class="back-link" href="#/login">← 退出当前账号</a><div class="select-header"><div><div class="eyebrow select-title">练习中心</div></div><div class="select-stats"><div><span>已作答题目</span><strong>${latestStats.answered}/${latestStats.total}</strong></div><div><span>作答正确率</span><strong>${latestStats.accuracy}</strong></div><div><span>作答正确分数</span><strong>${latestStats.correctScore}/${latestStats.answeredScore}</strong></div></div></div><div class="select-tabs" role="tablist">${tabs}</div><div class="paper-sections">${section}</div></main>`;
  document.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const paperId = button.dataset.paper;
      if (button.dataset.action === 'continue' || button.dataset.action === 'start') startExam(paperId);
      if (button.dataset.action === 'recent') navigate(`result/${button.dataset.attempt}`);
      if (button.dataset.action === 'retake') startNewAttempt(paperId);
    });
  });
  document.querySelectorAll('[data-select-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.selectCategory;
      state.selectPages[key] = Number(button.dataset.selectPage);
      renderSelect();
    });
  });
  document.querySelectorAll('[data-select-category]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.selectPage !== undefined) return;
      state.selectCategory = button.dataset.selectCategory;
      renderSelect();
    });
  });
}

function paperCategory(attempts = []) {
  if (attempts.some((item) => item.status === 'in_progress')) return 'in_progress';
  if (attempts.some((item) => item.status !== 'abandoned')) return 'completed';
  return 'not_started';
}

function aggregatePracticeStats(paperEntries = []) {
  const stats = { answered: 0, total: 0, correct: 0, gradedAnswered: 0, correctScore: 0, answeredScore: 0 };
  paperEntries.forEach(([, data, attempts = []]) => {
    const questions = data.questions || [];
    stats.total += questions.length;
    const latest = attempts.find((attempt) => attempt.status !== 'abandoned');
    if (!latest) return;
    const answers = latest.answers || {};
    const answeredIds = new Set(questions.filter((question) => question.type === 'subjective' ? typeof answers[question.id] === 'string' && answers[question.id].trim() : Array.isArray(answers[question.id]) && answers[question.id].length).map((question) => question.id));
    stats.answered += answeredIds.size;
    stats.answeredScore += questions.reduce((sum, question) => sum + (answeredIds.has(question.id) ? Number(question.score || 0) : 0), 0);
    const details = latest.grading?.details || {};
    if (latest.status === 'graded') {
      stats.correct += Object.values(details).filter((item) => item.isCorrect).length;
      stats.gradedAnswered += Object.values(details).filter((item) => item.selected?.length && !item.isSubjective).length;
      stats.correctScore += questions.reduce((sum, question) => sum + (details[question.id]?.isCorrect ? Number(question.score || 0) : 0), 0);
    }
  });
  return {
    ...stats,
    accuracy: stats.gradedAnswered ? `${Math.round((stats.correct / stats.gradedAnswered) * 100)}%` : '--'
  };
}

function paginateItems(items, page = 0, pageSize = 6) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.max(0, Math.min(pageCount - 1, Number(page) || 0));
  return { page: currentPage, pageCount, items: items.slice(currentPage * pageSize, (currentPage + 1) * pageSize) };
}

function renderPaperSection(key, title, description, entries) {
  const pagination = paginateItems(entries, state.selectPages[key], 6);
  state.selectPages[key] = pagination.page;
  const cards = pagination.items.map(([id, data, attempts], index) => paperCard(id, data, index + pagination.page * 6, attempts)).join('');
  const pager = pagination.pageCount > 1 ? `<div class="paper-pagination"><button class="button button-ghost button-sm" data-select-category="${key}" data-select-page="${pagination.page - 1}" ${pagination.page === 0 ? 'disabled' : ''}>上一页</button><span>第 ${pagination.page + 1} / ${pagination.pageCount} 页</span><button class="button button-ghost button-sm" data-select-category="${key}" data-select-page="${pagination.page + 1}" ${pagination.page === pagination.pageCount - 1 ? 'disabled' : ''}>下一页</button></div>` : '';
  return `<section class="paper-section"><div class="section-subhead"><div><h2>${title}</h2><p>${description}</p></div><span>${entries.length} 份</span></div>${entries.length ? `<div class="paper-grid">${cards}</div>${pager}` : '<div class="empty-state paper-empty">暂无试卷</div>'}</section>`;
}

function paperCard(id, data, index, attempts = []) {
  const paper = data.paper;
  const summary = summarizePaper(data);
  const answerStatus = paper.hasAnswerKey ? ['is-ready', '已配置答案'] : ['is-pending', '待配置答案'];
  const open = attempts.find((item) => item.status === 'in_progress');
  const submitted = attempts.find((item) => item.status !== 'in_progress' && item.status !== 'abandoned');
  const actions = [];
  if (open) actions.push(`<button class="button button-secondary button-sm" data-action="continue" data-paper="${escapeHTML(id)}">继续考试</button>`);
  if (submitted) actions.push(`<button class="button button-ghost button-sm" data-action="recent" data-paper="${escapeHTML(id)}" data-attempt="${escapeHTML(submitted.id)}">查看最近结果</button>`);
  if (open || submitted) actions.push(`<button class="button paper-action-primary button-sm" data-action="retake" data-paper="${escapeHTML(id)}">重新考试</button>`);
  if (!actions.length) actions.push(`<button class="button paper-action-primary button-sm" data-action="start" data-paper="${escapeHTML(id)}">开始考试</button>`);
  const history = attempts.length ? `<div class="paper-history">已完成 ${attempts.filter((item) => item.status !== 'in_progress' && item.status !== 'abandoned').length} 次</div>` : '';
  return `<article class="paper-card"><span class="paper-index">${String(index + 1).padStart(2, '0')}</span><h3>${escapeHTML(paper.title)}</h3><span class="paper-id">${escapeHTML(paper.id || id)}</span><p>${escapeHTML(paper.description)}</p><div class="paper-meta"><span class="tag">${data.questions.length} 题</span><span class="tag">${paper.durationMinutes} 分钟</span><span class="tag">${paper.totalScore} 分</span></div><div class="paper-stats"><span>单选 ${summary.single}</span><span>多选 ${summary.multiple}</span><span>不定项 ${summary.indefinite}</span>${summary.subjective ? `<span>主观题 ${summary.subjective}</span>` : ''}<span class="answer-status ${answerStatus[0]}">${answerStatus[1]}</span></div>${history}<div class="paper-actions">${actions.join('')}</div></article>`;
}

function summarizePaper(data = {}) {
  return (data.questions || []).reduce((summary, question) => {
    if (!Object.hasOwn(summary, question.type) && question.type === 'subjective') summary.subjective = 0;
    if (Object.hasOwn(summary, question.type)) summary[question.type] += 1;
    return summary;
  }, { single: 0, multiple: 0, indefinite: 0 });
}

// Keep pure rendering helpers available to lightweight browser/Node checks.
globalThis.__LAW_TEST_HOOKS__ = { summarizePaper, paperCard, paperCategory, paginateItems, aggregatePracticeStats, typeLabel, answerProvided, gradeAttempt, CloudRepository };

async function startExam(paperId) {
  const paper = await loadPaper(paperId);
  const attempts = await findAttempts(paperId);
  const open = attempts.find((item) => item.status === 'in_progress');
  if (open) {
    if (open.expiresAt <= Date.now()) { state.attempt = open; await submitAttempt(true); return; }
    if (!window.confirm(`发现 ${formatDate(open.startedAt)} 开始的未完成答卷，继续作答吗？`)) return;
    state.attempt = open;
  } else {
    return startNewAttempt(paperId, paper, attempts);
  }
  navigate(`exam/${paperId}`);
}

async function startNewAttempt(paperId, loadedPaper = null, loadedAttempts = null) {
  if (state.startingPaperIds.has(paperId)) return;
  state.startingPaperIds.add(paperId);
  try {
    const paper = loadedPaper || await loadPaper(paperId);
    const attempts = loadedAttempts || await findAttempts(paperId);
    const open = attempts.find((item) => item.status === 'in_progress');
    if (open) {
      if (open.expiresAt <= Date.now()) { state.attempt = open; await submitAttempt(true); return; }
      if (!window.confirm('当前试卷已有进行中的答卷。放弃当前答卷并重新开始吗？')) return;
      open.status = 'abandoned';
      open.abandonedAt = Date.now();
      await dbStore.put(open);
      if (cloudStore.enabled && state.session?.token) {
        try { await cloudStore.saveAttempt(open); } catch { /* keep local abandoned copy */ }
      }
    }
    state.attempt = createAttempt(paperId, paper, state.session.username);
    await persist();
    navigate(`exam/${paperId}`);
  } finally {
    state.startingPaperIds.delete(paperId);
  }
}

function stopTimer() { if (state.timer) window.clearInterval(state.timer); state.timer = null; }
function startTimer(paper) {
  stopTimer();
  const update = async () => {
    if (!state.attempt) return;
    const remaining = Math.max(0, Math.ceil((state.attempt.expiresAt - Date.now()) / 1000));
    const timer = document.querySelector('#timer');
    if (timer) { timer.textContent = formatTime(remaining); timer.classList.toggle('is-warning', remaining <= 300); }
    if (remaining === 0) { stopTimer(); await submitAttempt(true); }
  };
  update();
  state.timer = window.setInterval(update, 1000);
}

async function renderExam(paperId) {
  if (!state.session.paperIds.includes(paperId)) { navigate('select'); return; }
  const paper = await loadPaper(paperId);
  if (!state.attempt || state.attempt.paperId !== paperId) {
    const attempts = await findAttempts(paperId);
    state.attempt = attempts.find((item) => item.status === 'in_progress') || attempts[0];
  }
  if (!state.attempt || state.attempt.status !== 'in_progress') { navigate(`select`); return; }
  if (state.attempt.expiresAt <= Date.now()) { await submitAttempt(true); return; }
  const question = paper.questions[state.attempt.currentIndex];
  const selected = state.attempt.answers[question.id] || (question.type === 'subjective' ? '' : []);
  const marked = state.attempt.marked.includes(question.id);
  const answeredCount = paper.questions.filter((item) => answerProvided(item, state.attempt.answers[item.id])).length;
  const answerUI = question.type === 'subjective'
    ? `<label class="subjective-answer"><span>请输入你的答案</span><textarea id="subjective-answer" rows="10" maxlength="${Number(question.maxLength || 10000)}" placeholder="在此输入答案…">${escapeHTML(typeof selected === 'string' ? selected : '')}</textarea><small class="answer-hint">支持换行，内容会自动保存</small></label>`
    : question.options.map((option) => optionHTML(question, option, selected)).join('');
  app.innerHTML = `${topbar(state.session.username)}<main class="page exam-page"><div class="exam-top"><div class="exam-title"><h1>${escapeHTML(paper.paper.title)}</h1><span>${paper.questions.length} 题 · ${paper.paper.totalScore} 分 · ${paper.paper.durationMinutes} 分钟</span></div><div style="display:flex; gap:9px; align-items:center"><div id="timer" class="timer">--:--</div><button class="button button-coral button-sm" id="submit-top">交卷</button><button class="button button-ghost button-sm mobile-nav-toggle" id="scroll-nav">题号</button></div></div>
    <div class="exam-layout"><section class="question-card"><div class="question-meta"><span class="question-number">第 ${state.attempt.currentIndex + 1} 题 / ${paper.questions.length}</span><span class="question-type">${typeLabel(question.type)} · ${question.score} 分</span></div><div class="stem">${escapeHTML(question.stem)}</div><div class="options">${answerUI}</div><div class="question-actions"><div class="left"><button class="button button-sm mark-button ${marked ? 'is-marked' : ''}" id="mark-button">${marked ? '★ 已标记' : '☆ 标记题目'}</button></div><div class="right"><button class="button button-ghost button-sm" id="prev" ${state.attempt.currentIndex === 0 ? 'disabled' : ''}>上一题</button><button class="button button-secondary button-sm" id="next">${state.attempt.currentIndex === paper.questions.length - 1 ? '完成检查' : '下一题'}</button></div></div></section>
    <aside class="side-panel" id="side-panel"><h3>答题卡</h3><p class="progress-copy">已完成 ${answeredCount} / ${paper.questions.length}</p><div class="progress-bar"><span style="width:${(answeredCount / paper.questions.length) * 100}%"></span></div><div class="question-nav">${paper.questions.map((item, index) => `<button class="nav-item ${answerProvided(item, state.attempt.answers[item.id]) ? 'is-answered' : ''} ${state.attempt.currentIndex === index ? 'is-current' : ''} ${state.attempt.marked.includes(item.id) ? 'is-marked' : ''}" data-index="${index}">${index + 1}</button>`).join('')}</div><hr class="side-divider"><div class="legend"><span><i class="done"></i>已作答</span><span><i class="flag"></i>已标记</span><span><i></i>未作答</span></div><hr class="side-divider"><div class="side-actions"><button class="button button-coral" id="submit-side">交卷并查看结果</button></div></aside></div></main>`;
  startTimer(paper);
  document.querySelectorAll('.option-input').forEach((input) => input.addEventListener('change', () => updateAnswer(question, input)));
  document.querySelector('#subjective-answer')?.addEventListener('input', (event) => updateSubjectiveAnswer(question, event.target.value));
  document.querySelector('#mark-button').addEventListener('click', toggleMark);
  document.querySelector('#prev').addEventListener('click', () => moveQuestion(-1, paper));
  document.querySelector('#next').addEventListener('click', () => moveQuestion(1, paper));
  document.querySelector('#submit-top').addEventListener('click', () => confirmSubmit());
  document.querySelector('#submit-side').addEventListener('click', () => confirmSubmit());
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => { state.attempt.currentIndex = Number(button.dataset.index); persist().then(() => renderExam(paperId)); }));
  document.querySelector('#scroll-nav').addEventListener('click', () => document.querySelector('#side-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function optionHTML(question, option, selected) {
  const checked = selected.includes(option.key);
  const inputType = question.type === 'single' ? 'radio' : 'checkbox';
  return `<label class="option ${checked ? 'is-selected' : ''}"><input class="option-input" type="${inputType}" name="question-${escapeHTML(question.id)}" value="${escapeHTML(option.key)}" ${checked ? 'checked' : ''}><span class="option-key">${escapeHTML(option.key)}</span><span class="option-text">${escapeHTML(option.text)}</span></label>`;
}

async function updateAnswer(question, input) {
  const current = state.attempt.answers[question.id] || [];
  state.attempt.answers[question.id] = question.type === 'single' ? [input.value] : (input.checked ? [...new Set([...current, input.value])] : current.filter((key) => key !== input.value));
  await persist();
  const option = input.closest('.option');
  if (question.type === 'single') document.querySelectorAll('.option').forEach((item) => item.classList.remove('is-selected'));
  option.classList.toggle('is-selected', input.checked);
  const paper = await loadPaper(state.attempt.paperId);
  const answeredCount = paper.questions.filter((item) => answerProvided(item, state.attempt.answers[item.id])).length;
  document.querySelector('.progress-copy').textContent = `已完成 ${answeredCount} / ${document.querySelectorAll('.nav-item').length}`;
  const navItem = [...document.querySelectorAll('.nav-item')].find((item) => Number(item.dataset.index) === state.attempt.currentIndex);
  navItem?.classList.toggle('is-answered', Boolean(state.attempt.answers[question.id]?.length));
  const progress = document.querySelector('.progress-bar span');
  if (progress) progress.style.width = `${(answeredCount / document.querySelectorAll('.nav-item').length) * 100}%`;
}

async function updateSubjectiveAnswer(question, value) {
  state.attempt.answers[question.id] = String(value || '');
  await persist();
  const paper = await loadPaper(state.attempt.paperId);
  const answeredCount = paper.questions.filter((item) => answerProvided(item, state.attempt.answers[item.id])).length;
  const copy = document.querySelector('.progress-copy');
  if (copy) copy.textContent = `已完成 ${answeredCount} / ${paper.questions.length}`;
  const navItem = [...document.querySelectorAll('.nav-item')].find((item) => Number(item.dataset.index) === state.attempt.currentIndex);
  navItem?.classList.toggle('is-answered', answerProvided(question, value));
  const progress = document.querySelector('.progress-bar span');
  if (progress) progress.style.width = `${(answeredCount / paper.questions.length) * 100}%`;
}

async function toggleMark() {
  const questionId = state.attempt.answers ? document.querySelector('.question-number') && state.attempt.paperId && (await loadPaper(state.attempt.paperId)).questions[state.attempt.currentIndex].id : null;
  if (!questionId) return;
  state.attempt.marked = state.attempt.marked.includes(questionId) ? state.attempt.marked.filter((id) => id !== questionId) : [...state.attempt.marked, questionId];
  await persist();
  await renderExam(state.attempt.paperId);
}

async function moveQuestion(delta, paper) {
  state.attempt.currentIndex = Math.max(0, Math.min(paper.questions.length - 1, state.attempt.currentIndex + delta));
  await persist();
  await renderExam(paper.paper.id);
}

async function confirmSubmit() {
  const paper = await loadPaper(state.attempt.paperId);
  const unanswered = paper.questions.filter((question) => !answerProvided(question, state.attempt.answers[question.id])).length;
  const message = unanswered ? `还有 ${unanswered} 题未作答，确认现在交卷吗？` : '确认交卷并查看结果吗？交卷后将不能继续修改。';
  if (window.confirm(message)) await submitAttempt(false);
}

async function submitAttempt(auto = false) {
  if (!state.attempt || state.attempt.status !== 'in_progress') return;
  stopTimer();
  const paper = await loadPaper(state.attempt.paperId);
  let key = null;
  try {
    const response = await freshFetch(`data/exams/${encodeURIComponent(state.attempt.paperId)}/answer-key.json`);
    if (response.ok) key = await response.json();
  } catch { /* pending grading */ }
  key ||= globalThis.__LAW_DEMO__?.answerKeys?.[state.attempt.paperId] || null;
  state.attempt.submittedAt = Date.now();
  state.attempt.status = key ? 'graded' : 'submitted_ungraded';
  if (key) state.attempt.grading = gradeAttempt(paper, key, state.attempt.answers);
  if (cloudStore.enabled && state.session?.token) {
    try {
      const remote = await cloudStore.submitAttempt(state.attempt);
      state.attempt = { ...state.attempt, ...remote, status: remote.status || state.attempt.status, syncState: 'synced' };
    } catch {
      state.attempt.syncState = 'pending';
    }
  }
  await persist();
  navigate(`result/${state.attempt.id}`);
}

async function renderResult(attemptId) {
  stopTimer();
  let attempt = state.attempt?.id === attemptId ? state.attempt : await dbStore.get(attemptId);
  if (!attempt && cloudStore.enabled && state.session?.token) {
    try {
      attempt = await cloudStore.getAttempt(attemptId);
      if (attempt) await dbStore.put(attempt);
    } catch { /* show the normal missing-attempt redirect */ }
  }
  if (!attempt || attempt.username !== state.session.username || !state.session.paperIds.includes(attempt.paperId)) { navigate('select'); return; }
  state.attempt = attempt;
  const paper = await loadPaper(attempt.paperId);
  const attempts = await findAttempts(attempt.paperId);
  await loadAnnotations(attempt);
  const graded = attempt.status === 'graded' && attempt.grading;
  const score = graded ? attempt.grading.score : null;
  const details = attempt.grading?.details || {};
  const correctCount = graded ? Object.values(details).filter((item) => item.isCorrect).length : 0;
  const answeredCount = paper.questions.filter((question) => answerProvided(question, attempt.answers[question.id])).length;
  const filters = [{ key: 'all', label: '全部' }, { key: 'wrong', label: '答错' }, { key: 'empty', label: '未答' }, { key: 'marked', label: '已标记' }];
  const visibleQuestions = paper.questions.filter((question) => {
    const item = details[question.id];
    if (state.resultFilter === 'wrong') return item && !item.isSubjective && !item.isCorrect && item.selected.length;
    if (state.resultFilter === 'empty') return !answerProvided(question, attempt.answers[question.id]);
    if (state.resultFilter === 'marked') return attempt.marked.includes(question.id);
    return true;
  });
  const gradedTotal = graded ? (attempt.grading.total ?? paper.paper.totalScore) : paper.paper.totalScore;
  app.innerHTML = `${topbar(attempt.username)}<main class="page"><div class="result-hero"><div><div class="eyebrow">${graded ? '已完成批改' : '已提交 · 待批改'}</div><h1>${escapeHTML(paper.paper.title)}</h1><p style="margin-top:10px;color:#b9cad8;font-size:13px">提交时间 ${formatDate(attempt.submittedAt)}</p></div>${graded ? `<div class="result-score"><strong>${score}</strong><span>客观题总分 ${gradedTotal}</span></div>` : ''}</div>${graded ? `<div class="stats-grid"><div class="stat"><span>得分率</span><strong>${gradedTotal ? Math.round((score / gradedTotal) * 100) : 0}%</strong></div><div class="stat"><span>答对</span><strong>${correctCount}</strong></div><div class="stat"><span>答错</span><strong>${paper.questions.filter((q) => details[q.id]?.selected?.length && !details[q.id].isSubjective && !details[q.id].isCorrect).length}</strong></div><div class="stat"><span>未答</span><strong>${paper.questions.filter((q) => !answerProvided(q, attempt.answers[q.id])).length}</strong></div></div>` : `<div class="pending-card" style="margin-top:16px">本试卷尚未配置标准答案，暂不计算成绩。提交记录已保存在当前浏览器中。</div>`}<div class="result-toolbar"><div class="filter-group">${filters.map((filter) => `<button class="filter ${state.resultFilter === filter.key ? 'is-active' : ''}" data-filter="${filter.key}">${filter.label}</button>`).join('')}</div><div class="result-actions" style="margin-top:0"><button class="button button-primary button-sm" id="retake">重新考试</button><button class="button button-ghost button-sm" id="export">导出 JSON</button><button class="button button-secondary button-sm" id="export-html">导出 HTML</button><button class="button button-secondary button-sm" id="back-select">返回试卷</button></div></div><div class="result-list">${visibleQuestions.length ? visibleQuestions.map((question) => resultQuestion(question, attempt, graded, details[question.id], paper.questions.indexOf(question))).join('') : '<div class="empty-state">当前筛选下没有题目</div>'}</div>${renderAttemptHistory(attempts, attempt.id)}</main>`;
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { state.resultFilter = button.dataset.filter; renderResult(attemptId); }));
  document.querySelector('#export').addEventListener('click', () => exportAttempt(attempt, paper));
  document.querySelector('#export-html').addEventListener('click', () => exportAttemptHTML(attempt, paper));
  document.querySelector('#retake').addEventListener('click', () => startNewAttempt(attempt.paperId, paper, attempts));
  document.querySelector('#back-select').addEventListener('click', () => navigate('select'));
  document.querySelectorAll('[data-annotation-save]').forEach((button) => button.addEventListener('click', () => saveAnnotation(button.dataset.annotationSave)));
}

async function loadAnnotations(attempt) {
  attempt.annotations ||= {};
  if (!cloudStore.enabled || !state.session?.token) return attempt.annotations;
  try {
    const rows = await cloudStore.listAnnotations(attempt.id);
    rows.forEach((row) => {
      const questionId = row.questionId || row.question_id;
      if (questionId) attempt.annotations[questionId] = row.content || '';
    });
    await dbStore.put(attempt);
  } catch { /* annotations remain available from the local mirror */ }
  return attempt.annotations;
}

async function saveAnnotation(questionId) {
  const input = [...document.querySelectorAll('[data-annotation-question]')].find((item) => item.dataset.annotationQuestion === questionId);
  const status = [...document.querySelectorAll('[data-annotation-status]')].find((item) => item.dataset.annotationStatus === questionId);
  if (!input || !state.attempt) return;
  const content = String(input.value || '').trim();
  state.attempt.annotations ||= {};
  state.attempt.pendingAnnotations ||= {};
  state.attempt.annotations[questionId] = content;
  state.attempt.pendingAnnotations[questionId] = content;
  if (status) status.textContent = '保存中…';
  await dbStore.put(state.attempt);
  try {
    if (cloudStore.enabled && state.session?.token) await cloudStore.saveAnnotation(state.attempt.id, questionId, content);
    delete state.attempt.pendingAnnotations[questionId];
    await dbStore.put(state.attempt);
    if (status) status.textContent = '已保存';
  } catch {
    if (status) status.textContent = '已保存到本机，待同步';
  }
}

function resultQuestion(question, attempt, graded, detail, index) {
  const selected = detail?.selected || attempt.answers[question.id] || (question.type === 'subjective' ? '' : []);
  const annotation = attempt.annotations?.[question.id] || '';
  if (question.type === 'subjective') {
    return `<article class="result-question"><div class="result-question-head"><strong>第 ${index + 1} 题 · ${typeLabel(question.type)}</strong><span class="status is-pending">自评参考</span></div><p class="result-stem">${escapeHTML(question.stem)}</p><div class="subjective-response"><h4>你的答案</h4><p>${selected ? escapeHTML(selected) : '未作答'}</p></div>${detail?.referenceAnswer ? `<div class="reference-answer"><h4>参考答案</h4><p>${escapeHTML(detail.referenceAnswer)}</p></div>` : ''}${detail?.analysis ? `<div class="analysis">${escapeHTML(detail.analysis)}</div>` : ''}<div class="annotation-box"><label for="annotation-${escapeHTML(question.id)}">个人批注</label><textarea id="annotation-${escapeHTML(question.id)}" data-annotation-question="${escapeHTML(question.id)}" rows="3" placeholder="记录复盘要点…">${escapeHTML(annotation)}</textarea><div class="annotation-actions"><button class="button button-ghost button-sm" data-annotation-save="${escapeHTML(question.id)}">保存批注</button><span data-annotation-status="${escapeHTML(question.id)}"></span></div></div></article>`;
  }
  const correct = detail?.correct || [];
  const status = !selected.length ? ['empty', '未作答'] : detail?.isCorrect ? ['correct', '回答正确'] : ['wrong', '回答错误'];
  const options = question.options.map((option) => {
    const isSelected = selected.includes(option.key);
    const isCorrect = correct.includes(option.key);
    const labels = [isSelected ? '你的选择' : '', isCorrect ? '正确答案' : ''].filter(Boolean);
    return `<div class="result-option ${isSelected ? 'is-selected' : ''} ${isCorrect ? 'is-correct' : ''}"><span class="option-key">${escapeHTML(option.key)}</span><span class="option-text">${escapeHTML(option.text)}</span>${labels.length ? `<span class="result-option-label">${labels.join(' · ')}</span>` : ''}</div>`;
  }).join('');
  return `<article class="result-question"><div class="result-question-head"><strong>第 ${index + 1} 题 · ${typeLabel(question.type)}</strong>${graded ? `<span class="status ${status[0]}">${status[1]}</span>` : ''}</div><p class="result-stem">${escapeHTML(question.stem)}</p><div class="result-options">${options}</div>${graded ? `<div class="result-answer"><span>你的答案 <strong>${selected.length ? escapeHTML(selected.join('、')) : '未作答'}</strong></span><span>正确答案 <strong>${escapeHTML(correct.join('、'))}</strong></span></div>${detail?.analysis ? `<div class="analysis">${escapeHTML(detail.analysis)}</div>` : ''}` : ''}<div class="annotation-box"><label for="annotation-${escapeHTML(question.id)}">个人批注</label><textarea id="annotation-${escapeHTML(question.id)}" data-annotation-question="${escapeHTML(question.id)}" rows="3" placeholder="记录复盘要点…">${escapeHTML(annotation)}</textarea><div class="annotation-actions"><button class="button button-ghost button-sm" data-annotation-save="${escapeHTML(question.id)}">保存批注</button><span data-annotation-status="${escapeHTML(question.id)}"></span></div></div></article>`;
}

function exportAttempt(attempt, paper) {
  const payload = { paperId: attempt.paperId, paperVersion: attempt.paperVersion, username: attempt.username, startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, status: attempt.status, answers: attempt.answers, marked: attempt.marked, annotations: attempt.annotations || {}, grading: attempt.grading || null };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${paper.paper.id}-${attempt.id}.json`; link.click(); URL.revokeObjectURL(link.href);
}

function exportAttemptHTML(attempt, paper) {
  const graded = attempt.status === 'graded' && attempt.grading;
  const details = attempt.grading?.details || {};
  const questions = paper.questions.map((question, index) => {
    const selected = details[question.id]?.selected || attempt.answers[question.id] || (question.type === 'subjective' ? '' : []);
    const detail = details[question.id];
    const options = question.type === 'subjective' ? '' : `<ol>${question.options.map((option) => `<li class="${selected.includes(option.key) ? 'selected' : ''}"><b>${escapeHTML(option.key)}</b> ${escapeHTML(option.text)}${selected.includes(option.key) ? ' <em>你的选择</em>' : ''}</li>`).join('')}</ol>`;
    const answer = question.type === 'subjective'
      ? `<div class="answer"><span>你的答案：<strong>${selected ? escapeHTML(selected) : '未作答'}</strong></span>${detail?.referenceAnswer ? `<span>参考答案：<strong>${escapeHTML(detail.referenceAnswer)}</strong></span>` : ''}</div>`
      : graded ? `<div class="answer"><span>你的答案：<strong>${selected.length ? escapeHTML(selected.join('、')) : '未作答'}</strong></span><span>正确答案：<strong>${escapeHTML((detail?.correct || []).join('、'))}</strong></span></div>` : '';
    const analysis = detail?.analysis ? `<div class="analysis">${escapeHTML(detail.analysis)}</div>` : '';
    const annotation = attempt.annotations?.[question.id] ? `<div class="analysis"><strong>个人批注：</strong>${escapeHTML(attempt.annotations[question.id])}</div>` : '';
    return `<article class="question"><h2>第 ${index + 1} 题 <small>${typeLabel(question.type)} · ${question.score} 分</small></h2><p>${escapeHTML(question.stem)}</p>${options}${answer}${analysis}${annotation}</article>`;
  }).join('');
  const exportTotal = graded ? (attempt.grading.total ?? paper.paper.totalScore) : paper.paper.totalScore;
  const summary = graded ? `<div class="summary"><strong>${attempt.grading.score}</strong> / ${exportTotal} 分　客观题得分率 ${exportTotal ? Math.round((attempt.grading.score / exportTotal) * 100) : 0}%</div>` : '<div class="pending">本试卷尚未配置标准答案，暂不计算成绩。</div>';
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(paper.paper.title)} - 答卷</title><style>body{margin:0;background:#f2f5f8;color:#18324a;font:15px/1.75 Arial,"Microsoft YaHei",sans-serif}.sheet{max-width:880px;margin:0 auto;padding:36px 24px}.head{background:#1769aa;color:#fff;padding:24px 28px;border-radius:4px}.head h1{margin:0 0 8px;font-size:28px}.head p{margin:0;color:#d9ecfb}.summary,.pending{margin:16px 0;padding:18px 22px;background:#fff;border:1px solid #d9e2ec;border-radius:4px}.summary strong{font-size:34px;color:#1769aa}.question{margin:14px 0;padding:20px 22px;background:#fff;border:1px solid #d9e2ec;border-radius:4px;break-inside:avoid}.question h2{margin:0 0 12px;font-size:17px}.question h2 small{float:right;color:#6b8298;font-size:12px;font-weight:normal}.question p{margin:0 0 12px}.question ol{margin:0;padding-left:28px}.question li{padding:3px 8px}.question li.selected{background:#e6f3f1;color:#0f766e}.question li em{font-size:12px;font-style:normal}.answer{display:flex;gap:24px;flex-wrap:wrap;margin-top:14px;color:#6b8298;font-size:13px}.answer strong{color:#18324a}.analysis{margin-top:12px;padding:10px 12px;background:#fbf8f0;border-left:3px solid #b08943;font-size:13px}.pending{color:#6b8298}@media print{body{background:#fff}.sheet{padding:0}.head{color:#000;background:#fff;border:2px solid #1769aa}.head p{color:#536b80}}</style></head><body><main class="sheet"><header class="head"><h1>${escapeHTML(paper.paper.title)}</h1><p>考生：${escapeHTML(attempt.username)}　提交时间：${formatDate(attempt.submittedAt)}</p></header>${summary}${questions}</main></body></html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${paper.paper.id}-${attempt.id}-答卷.html`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function renderRoute() {
  const current = route();
  if (current === 'login') { renderLogin(); return; }
  if (!state.session) { navigate('login'); return; }
  if (current === 'select') { await renderSelect(); return; }
  if (current.startsWith('exam/')) { await renderExam(current.split('/')[1]); return; }
  if (current.startsWith('result/')) { await renderResult(current.split('/')[1]); return; }
  navigate('login');
}

window.addEventListener('hashchange', renderRoute);
window.addEventListener('online', async () => {
  if (!cloudStore.enabled || !state.session?.token) return;
  const pending = (await dbStore.all()).filter((attempt) => attempt.username === state.session.username && attempt.syncState === 'pending');
  for (const attempt of pending) {
    try {
      const uploaded = ['submitted_ungraded', 'graded'].includes(attempt.status)
        ? await cloudStore.submitAttempt(attempt)
        : await cloudStore.saveAttempt(attempt);
      await dbStore.put({ ...attempt, ...uploaded, syncState: 'synced' });
    } catch { /* next online event will retry */ }
  }
  const annotated = (await dbStore.all()).filter((attempt) => attempt.username === state.session.username && Object.keys(attempt.pendingAnnotations || {}).length);
  for (const attempt of annotated) {
    for (const [questionId, content] of Object.entries(attempt.pendingAnnotations || {})) {
      try {
        await cloudStore.saveAnnotation(attempt.id, questionId, content);
        delete attempt.pendingAnnotations[questionId];
      } catch { /* next online event will retry */ }
    }
    await dbStore.put(attempt);
  }
});
(async function boot() {
  await dbStore.init();
  try {
    const response = await freshFetch('data/registry.json');
    state.registry = await response.json();
    await renderRoute();
  } catch {
    state.registry = globalThis.__LAW_DEMO__?.registry || null;
    if (state.registry) await renderRoute();
    else renderLogin('题库配置加载失败，请检查静态文件是否完整。');
  }
})();
