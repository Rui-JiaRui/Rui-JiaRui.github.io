const app = document.querySelector('#app');
const DEMO_HINT = '演示账号：student01 · 密码：law2026';

const state = {
  registry: null,
  papers: new Map(),
  session: JSON.parse(sessionStorage.getItem('law-session') || 'null'),
  attempt: null,
  timer: null,
  resultFilter: 'all'
};

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
const typeLabel = (type) => ({ single: '单项选择', multiple: '多项选择', indefinite: '不定项选择' }[type] || type);
const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const formatDate = (stamp) => new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(stamp));
const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function sha256(value) {
  if (!globalThis.crypto?.subtle) {
    if (value === 'law2026') return 'ededc647b824693a6a632e7ceb8bbdc4feea781ba5d68bd52e382b202d714c3d';
    throw new Error('Web Crypto unavailable');
  }
  try {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    if (value === 'law2026') return 'ededc647b824693a6a632e7ceb8bbdc4feea781ba5d68bd52e382b202d714c3d';
    throw error;
  }
}

async function loadPaper(paperId) {
  if (state.papers.has(paperId)) return state.papers.get(paperId);
  let paper;
  try {
    const response = await fetch(`data/exams/${encodeURIComponent(paperId)}/paper.json`);
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
  const all = await dbStore.all();
  return all.filter((item) => item.paperId === paperId && item.username === state.session?.username).sort((a, b) => b.startedAt - a.startedAt);
}

async function persist() {
  if (state.attempt) await dbStore.put(state.attempt);
}

function topbar(candidate = '') {
  return `<header class="topbar">
    <a class="brand" href="#/login" aria-label="返回首页"><span class="brand-mark">法</span><span class="brand-copy"><strong>法序</strong><span>LAW PRACTICE</span></span></a>
    ${candidate ? `<div class="topbar-meta"><span>本地练习模式</span><span class="candidate-chip"><i class="avatar">${escapeHTML(candidate.slice(0, 1).toUpperCase())}</i>${escapeHTML(candidate)}</span></div>` : ''}
  </header>`;
}

function renderLogin(error = '') {
  stopTimer();
  state.session = null;
  sessionStorage.removeItem('law-session');
  app.innerHTML = `${topbar()}<main class="page login-layout">
    <section class="login-intro"><div class="eyebrow">司法考试 · 客观题练习</div><h1>把每一次练习，<br>都变成可复盘的进步。</h1><div class="intro-rule"></div>
      <ul class="notice-list"><li>固定题库，浏览器本地保存答题进度</li><li>支持单选、多选、不定项选择与倒计时</li><li>交卷后即时查看得分、错题与解析</li></ul>
    </section>
    <section class="login-card"><h2>进入练习</h2><p>使用分配的账号登录，系统会自动匹配可用试卷。</p>
      ${error ? `<div class="error" role="alert">${escapeHTML(error)}</div>` : ''}
      <form id="login-form"><div class="field"><label for="username">账号</label><input id="username" name="username" autocomplete="username" required autofocus></div>
      <div class="field"><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
      <button class="button button-primary" type="submit">验证并继续</button></form>
      <p class="helper">${DEMO_HINT}<br>答卷仅保存在当前浏览器，不会上传到服务器。</p>
    </section></main>`;
  document.querySelector('#login-form').addEventListener('submit', handleLogin);
}

async function handleLogin(event) {
  event.preventDefault();
  if (!state.registry?.accounts) { renderLogin('账号配置尚未加载，请刷新页面后重试。'); return; }
  const form = new FormData(event.currentTarget);
  const username = String(form.get('username')).trim();
  const passwordHash = `sha-256:${await sha256(String(form.get('password')))}`;
  const account = state.registry.accounts.find((item) => item.enabled && item.username === username && item.passwordHash === passwordHash);
  if (!account) { renderLogin('账号或密码不正确，请重新输入。'); return; }
  state.session = { username, paperIds: account.paperIds };
  sessionStorage.setItem('law-session', JSON.stringify(state.session));
  const target = account.paperIds.length > 1 ? 'select' : `exam/${account.paperIds[0]}`;
  navigate(target);
}

async function renderSelect() {
  stopTimer();
  const paperEntries = await Promise.all(state.session.paperIds.map(async (id) => [id, await loadPaper(id)]));
  app.innerHTML = `${topbar(state.session.username)}<main class="page"><a class="back-link" href="#/login">← 退出当前账号</a><div class="section-head"><div><div class="eyebrow">选择试卷</div><h1>开始一场练习</h1><p class="lead">选择一套试卷进入答题。未完成的答卷会在本机自动保存。</p></div></div><div class="paper-grid">${paperEntries.map(([id, data], index) => paperCard(id, data, index)).join('')}</div></main>`;
  document.querySelectorAll('[data-paper]').forEach((button) => button.addEventListener('click', () => startExam(button.dataset.paper)));
}

function paperCard(id, data, index) {
  const paper = data.paper;
  return `<button class="paper-card" data-paper="${escapeHTML(id)}"><span class="paper-index">${String(index + 1).padStart(2, '0')}</span><h3>${escapeHTML(paper.title)}</h3><p>${escapeHTML(paper.description)}</p><div class="paper-meta"><span class="tag">${data.questions.length} 题</span><span class="tag">${paper.durationMinutes} 分钟</span><span class="tag">${paper.totalScore} 分</span></div></button>`;
}

async function startExam(paperId) {
  const paper = await loadPaper(paperId);
  const attempts = await findAttempts(paperId);
  const open = attempts.find((item) => item.status === 'in_progress');
  if (open) {
    if (open.expiresAt <= Date.now()) { state.attempt = open; await submitAttempt(true); return; }
    if (!window.confirm(`发现 ${formatDate(open.startedAt)} 开始的未完成答卷，继续作答吗？`)) return;
    state.attempt = open;
  } else {
    const submitted = attempts.find((item) => item.status !== 'in_progress');
    if (submitted) { navigate(`result/${submitted.id}`); return; }
    state.attempt = { id: uid(), username: state.session.username, paperId, paperVersion: paper.schemaVersion || '1.0', startedAt: Date.now(), expiresAt: Date.now() + paper.paper.durationMinutes * 60 * 1000, currentIndex: 0, answers: {}, marked: [], status: 'in_progress' };
    await persist();
  }
  navigate(`exam/${paperId}`);
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
  const selected = state.attempt.answers[question.id] || [];
  const marked = state.attempt.marked.includes(question.id);
  const answeredCount = Object.values(state.attempt.answers).filter((answer) => answer?.length).length;
  app.innerHTML = `${topbar(state.session.username)}<main class="page exam-page"><div class="exam-top"><div class="exam-title"><h1>${escapeHTML(paper.paper.title)}</h1><span>${paper.questions.length} 题 · ${paper.paper.totalScore} 分 · ${paper.paper.durationMinutes} 分钟</span></div><div style="display:flex; gap:9px; align-items:center"><div id="timer" class="timer">--:--</div><button class="button button-coral button-sm" id="submit-top">交卷</button><button class="button button-ghost button-sm mobile-nav-toggle" id="scroll-nav">题号</button></div></div>
    <div class="exam-layout"><section class="question-card"><div class="question-meta"><span class="question-number">第 ${state.attempt.currentIndex + 1} 题 / ${paper.questions.length}</span><span class="question-type">${typeLabel(question.type)} · ${question.score} 分</span></div><div class="stem">${escapeHTML(question.stem)}</div><div class="options">${question.options.map((option) => optionHTML(question, option, selected)).join('')}</div><div class="question-actions"><div class="left"><button class="button button-sm mark-button ${marked ? 'is-marked' : ''}" id="mark-button">${marked ? '★ 已标记' : '☆ 标记题目'}</button></div><div class="right"><button class="button button-ghost button-sm" id="prev" ${state.attempt.currentIndex === 0 ? 'disabled' : ''}>上一题</button><button class="button button-secondary button-sm" id="next">${state.attempt.currentIndex === paper.questions.length - 1 ? '完成检查' : '下一题'}</button></div></div></section>
    <aside class="side-panel" id="side-panel"><h3>答题卡</h3><p class="progress-copy">已完成 ${answeredCount} / ${paper.questions.length}</p><div class="progress-bar"><span style="width:${(answeredCount / paper.questions.length) * 100}%"></span></div><div class="question-nav">${paper.questions.map((item, index) => `<button class="nav-item ${state.attempt.answers[item.id]?.length ? 'is-answered' : ''} ${state.attempt.currentIndex === index ? 'is-current' : ''} ${state.attempt.marked.includes(item.id) ? 'is-marked' : ''}" data-index="${index}">${index + 1}</button>`).join('')}</div><hr class="side-divider"><div class="legend"><span><i class="done"></i>已作答</span><span><i class="flag"></i>已标记</span><span><i></i>未作答</span></div><hr class="side-divider"><div class="side-actions"><button class="button button-coral" id="submit-side">交卷并查看结果</button></div></aside></div></main>`;
  startTimer(paper);
  document.querySelectorAll('.option-input').forEach((input) => input.addEventListener('change', () => updateAnswer(question, input)));
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
  const answeredCount = Object.values(state.attempt.answers).filter((answer) => answer?.length).length;
  document.querySelector('.progress-copy').textContent = `已完成 ${answeredCount} / ${document.querySelectorAll('.nav-item').length}`;
  const navItem = [...document.querySelectorAll('.nav-item')].find((item) => Number(item.dataset.index) === state.attempt.currentIndex);
  navItem?.classList.toggle('is-answered', Boolean(state.attempt.answers[question.id]?.length));
  const progress = document.querySelector('.progress-bar span');
  if (progress) progress.style.width = `${(answeredCount / document.querySelectorAll('.nav-item').length) * 100}%`;
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
  const unanswered = paper.questions.length - Object.values(state.attempt.answers).filter((answer) => answer?.length).length;
  const message = unanswered ? `还有 ${unanswered} 题未作答，确认现在交卷吗？` : '确认交卷并查看结果吗？交卷后将不能继续修改。';
  if (window.confirm(message)) await submitAttempt(false);
}

async function submitAttempt(auto = false) {
  if (!state.attempt || state.attempt.status !== 'in_progress') return;
  stopTimer();
  const paper = await loadPaper(state.attempt.paperId);
  let key = null;
  try {
    const response = await fetch(`data/exams/${encodeURIComponent(state.attempt.paperId)}/answer-key.json`);
    if (response.ok) key = await response.json();
  } catch { /* pending grading */ }
  key ||= globalThis.__LAW_DEMO__?.answerKeys?.[state.attempt.paperId] || null;
  state.attempt.submittedAt = Date.now();
  state.attempt.status = key ? 'graded' : 'submitted_ungraded';
  if (key) {
    const details = {};
    let score = 0;
    paper.questions.forEach((question) => {
      const correct = key.answers[question.id]?.answer || [];
      const selected = state.attempt.answers[question.id] || [];
      const isCorrect = correct.length === selected.length && correct.every((item) => selected.includes(item));
      if (isCorrect) score += Number(question.score || 0);
      details[question.id] = { selected, correct, isCorrect, analysis: key.answers[question.id]?.analysis || '' };
    });
    state.attempt.grading = { score, total: paper.paper.totalScore, details, version: key.version || '1.0' };
  }
  await persist();
  navigate(`result/${state.attempt.id}`);
}

async function renderResult(attemptId) {
  stopTimer();
  const attempt = state.attempt?.id === attemptId ? state.attempt : await dbStore.get(attemptId);
  if (!attempt || attempt.username !== state.session.username || !state.session.paperIds.includes(attempt.paperId)) { navigate('select'); return; }
  state.attempt = attempt;
  const paper = await loadPaper(attempt.paperId);
  const graded = attempt.status === 'graded' && attempt.grading;
  const score = graded ? attempt.grading.score : null;
  const details = attempt.grading?.details || {};
  const correctCount = graded ? Object.values(details).filter((item) => item.isCorrect).length : 0;
  const answeredCount = Object.values(attempt.answers).filter((answer) => answer?.length).length;
  const filters = [{ key: 'all', label: '全部' }, { key: 'wrong', label: '答错' }, { key: 'empty', label: '未答' }, { key: 'marked', label: '已标记' }];
  const visibleQuestions = paper.questions.filter((question) => {
    const item = details[question.id];
    if (state.resultFilter === 'wrong') return item && !item.isCorrect && item.selected.length;
    if (state.resultFilter === 'empty') return !attempt.answers[question.id]?.length;
    if (state.resultFilter === 'marked') return attempt.marked.includes(question.id);
    return true;
  });
  app.innerHTML = `${topbar(attempt.username)}<main class="page"><div class="result-hero"><div><div class="eyebrow">${graded ? '已完成批改' : '已提交 · 待批改'}</div><h1>${escapeHTML(paper.paper.title)}</h1><p style="margin-top:10px;color:#b9cad8;font-size:13px">提交时间 ${formatDate(attempt.submittedAt)}</p></div>${graded ? `<div class="result-score"><strong>${score}</strong><span>总分 ${paper.paper.totalScore}</span></div>` : ''}</div>${graded ? `<div class="stats-grid"><div class="stat"><span>得分率</span><strong>${Math.round((score / paper.paper.totalScore) * 100)}%</strong></div><div class="stat"><span>答对</span><strong>${correctCount}</strong></div><div class="stat"><span>答错</span><strong>${paper.questions.filter((q) => details[q.id]?.selected?.length && !details[q.id].isCorrect).length}</strong></div><div class="stat"><span>未答</span><strong>${paper.questions.length - answeredCount}</strong></div></div>` : `<div class="pending-card" style="margin-top:16px">本试卷尚未配置标准答案，暂不计算成绩。提交记录已保存在当前浏览器中。</div>`}<div class="result-toolbar"><div class="filter-group">${filters.map((filter) => `<button class="filter ${state.resultFilter === filter.key ? 'is-active' : ''}" data-filter="${filter.key}">${filter.label}</button>`).join('')}</div><div class="result-actions" style="margin-top:0"><button class="button button-ghost button-sm" id="export">导出 JSON</button><button class="button button-secondary button-sm" id="export-html">导出 HTML</button><button class="button button-secondary button-sm" id="back-select">返回试卷</button></div></div><div class="result-list">${visibleQuestions.length ? visibleQuestions.map((question, index) => resultQuestion(question, attempt, graded, details[question.id], index)).join('') : '<div class="empty-state">当前筛选下没有题目</div>'}</div></main>`;
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { state.resultFilter = button.dataset.filter; renderResult(attemptId); }));
  document.querySelector('#export').addEventListener('click', () => exportAttempt(attempt, paper));
  document.querySelector('#export-html').addEventListener('click', () => exportAttemptHTML(attempt, paper));
  document.querySelector('#back-select').addEventListener('click', () => navigate('select'));
}

function resultQuestion(question, attempt, graded, detail, index) {
  const selected = detail?.selected || attempt.answers[question.id] || [];
  const status = !selected.length ? ['empty', '未作答'] : detail?.isCorrect ? ['correct', '回答正确'] : ['wrong', '回答错误'];
  return `<article class="result-question"><div class="result-question-head"><strong>第 ${index + 1} 题 · ${typeLabel(question.type)}</strong>${graded ? `<span class="status ${status[0]}">${status[1]}</span>` : ''}</div><p class="result-stem">${escapeHTML(question.stem)}</p>${graded ? `<div class="result-answer"><span>你的答案 <strong>${selected.length ? escapeHTML(selected.join('、')) : '未作答'}</strong></span><span>正确答案 <strong>${escapeHTML((detail?.correct || []).join('、'))}</strong></span></div>${detail?.analysis ? `<div class="analysis">${escapeHTML(detail.analysis)}</div>` : ''}` : ''}</article>`;
}

function exportAttempt(attempt, paper) {
  const payload = { paperId: attempt.paperId, paperVersion: attempt.paperVersion, username: attempt.username, startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, status: attempt.status, answers: attempt.answers, marked: attempt.marked, grading: attempt.grading || null };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${paper.paper.id}-${attempt.id}.json`; link.click(); URL.revokeObjectURL(link.href);
}

function exportAttemptHTML(attempt, paper) {
  const graded = attempt.status === 'graded' && attempt.grading;
  const details = attempt.grading?.details || {};
  const questions = paper.questions.map((question, index) => {
    const selected = details[question.id]?.selected || attempt.answers[question.id] || [];
    const detail = details[question.id];
    const options = question.options.map((option) => `<li class="${selected.includes(option.key) ? 'selected' : ''}"><b>${escapeHTML(option.key)}</b> ${escapeHTML(option.text)}${selected.includes(option.key) ? ' <em>你的选择</em>' : ''}</li>`).join('');
    const answer = graded ? `<div class="answer"><span>你的答案：<strong>${selected.length ? escapeHTML(selected.join('、')) : '未作答'}</strong></span><span>正确答案：<strong>${escapeHTML((detail?.correct || []).join('、'))}</strong></span></div>${detail?.analysis ? `<div class="analysis">${escapeHTML(detail.analysis)}</div>` : ''}` : '';
    return `<article class="question"><h2>第 ${index + 1} 题 <small>${typeLabel(question.type)} · ${question.score} 分</small></h2><p>${escapeHTML(question.stem)}</p><ol>${options}</ol>${answer}</article>`;
  }).join('');
  const summary = graded ? `<div class="summary"><strong>${attempt.grading.score}</strong> / ${paper.paper.totalScore} 分　得分率 ${Math.round((attempt.grading.score / paper.paper.totalScore) * 100)}%</div>` : '<div class="pending">本试卷尚未配置标准答案，暂不计算成绩。</div>';
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
(async function boot() {
  await dbStore.init();
  try {
    const response = await fetch('data/registry.json');
    state.registry = await response.json();
    await renderRoute();
  } catch {
    state.registry = globalThis.__LAW_DEMO__?.registry || null;
    if (state.registry) await renderRoute();
    else renderLogin('题库配置加载失败，请检查静态文件是否完整。');
  }
})();
