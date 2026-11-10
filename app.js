'use strict';

/* ============================================================
   页后 · AFTER THE PAGE
   把今天读过的内容投进来，它替你留住要点；
   第二天打开，先读一份昨日简报。
   ============================================================ */

/* 云服务激活时下发的 publicConfig（可安全暴露在前端） */
const PUBLIC_CONFIG = {
  endpoint: 'https://yehou-read.app.workbuddy.host',
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: 'wbpk_G0bjjOAUPyd25EJiuC7mVC_caxRdOZAKOdGYzZ7Eg48cxf2rnhP3fCu',
};

const MAX_CHARS = 24000;

const TYPE_LABEL = { book: '书', article: '文章', note: '笔记', other: '其他' };

const DIGEST_SYSTEM = `你是一位敏锐的阅读助手。用户会把今天读完的一段内容交给你。你的任务不是复述，而是帮他真正把这段内容吃进去、留下来。

要求：
- 一律使用简体中文。
- 语言克制、具体、准确。不用形容词堆砌，不用「本文」「作者认为」「深入探讨」这类空话开头。
- 摘要要写出观点本身，不要写成「讨论了……的问题」。
- 核心论点必须是判断句，不是话题名。
- 金句必须是原文里的原话，一字不改；找不到合适的就返回空数组。
- 不要编造原文没有的信息。宁少不编。`;

const BRIEF_SYSTEM = `你是一位阅读教练。用户每天读完几段内容，你负责把这一天串起来，写成一份他第二天早上会读到的简报。

要求：
- 一律使用简体中文。
- 不要罗列，要找出几段内容之间真实的联系：互相印证、互相冲突，或者其实是同一个问题的不同侧面。
- 如果它们之间确实没有关系，就诚实地说没有，不要硬编线索。
- 具体到内容本身。不要写「继续深入思考」「保持阅读习惯」这种空话。
- 你不要夸张地赞美用户的阅读品味。`;

/* ---------------- DOM ---------------- */

const $ = (id) => document.getElementById(id);

const el = {
  authView: $('authView'),
  mainView: $('mainView'),
  authForm: $('authForm'),
  wechatBtn: $('wechatBtn'),
  email: $('emailInput'),
  code: $('codeInput'),
  sendCodeBtn: $('sendCodeBtn'),
  enterBtn: $('enterBtn'),
  authError: $('authError'),
  userLabel: $('userLabel'),
  signOutBtn: $('signOutBtn'),
  todayView: $('todayView'),
  archiveView: $('archiveView'),
  hero: $('heroBrief'),
  title: $('titleInput'),
  type: $('typeSelect'),
  source: $('sourceInput'),
  content: $('contentInput'),
  charCount: $('charCount'),
  digestBtn: $('digestBtn'),
  composeError: $('composeError'),
  streamBox: $('streamBox'),
  streamText: $('streamText'),
  streamLabel: $('streamLabel'),
  todayList: $('todayList'),
  todayEmpty: $('todayEmpty'),
  todayCount: $('todayCount'),
  streakNum: $('streakNum'),
  todayNum: $('todayNum'),
  todayWords: $('todayWords'),
  totalDays: $('totalDays'),
  tagBox: $('tagBox'),
  tagList: $('tagList'),
  closeDayBtn: $('closeDayBtn'),
  closeDayHint: $('closeDayHint'),
  archiveList: $('archiveList'),
  archiveEmpty: $('archiveEmpty'),
  overlay: $('overlay'),
  overlayText: $('overlayText'),
  overlayLabel: $('overlayLabel'),
  toast: $('toast'),
};

/* ---------------- 工具 ---------------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDate(ymdStr, delta) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return ymd(dt);
}

function dayDiff(from, to) {
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function fmtCN(ymdStr) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${m}月${d}日 周${'日一二三四五六'[dt.getDay()]}`;
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function strList(v, max) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).slice(0, max || 8);
}

function conceptList(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((c) => ({
      term: c && typeof c.term === 'string' ? c.term.trim() : '',
      gloss: c && typeof c.gloss === 'string' ? c.gloss.trim() : '',
    }))
    .filter((c) => c.term)
    .slice(0, 5);
}

function threadList(v) {
  if (!Array.isArray(v)) return [];
  return v
    .map((t) => ({
      title: t && typeof t.title === 'string' ? t.title.trim() : '',
      body: t && typeof t.body === 'string' ? t.body.trim() : '',
    }))
    .filter((t) => t.title || t.body)
    .slice(0, 4);
}

function errMsg(e) {
  if (!e) return '出了点问题，请再试一次。';
  if (e.code && String(e.code).startsWith('quota_')) return '模型额度用完了，稍后再试。';
  if (e.code && String(e.code).startsWith('gateway_')) return '模型服务暂时不可用，请稍后再试。';
  if (e.code && String(e.code).startsWith('auth_')) return '云服务凭证校验失败，请检查应用配置。';
  return e.message || String(e);
}

let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), 3000);
}

/* ---------------- 云服务客户端 ---------------- */

let cloud = null;
let sdkError = '';

try {
  if (!window.WorkBuddyCloud || typeof window.WorkBuddyCloud.createWorkBuddyCloud !== 'function') {
    throw new Error('云端 SDK 未能加载，请检查网络后刷新页面。');
  }
  cloud = window.WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: PUBLIC_CONFIG.endpoint,
    oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
    publishableKey: PUBLIC_CONFIG.publishableKey,
  });
} catch (e) {
  sdkError = e.message || '初始化失败';
}

/* ---------------- 状态 ---------------- */

const state = {
  user: null,
  today: ymd(new Date()),
  readings: [],
  briefings: [],
  view: 'today',
  busy: false,
  pastBriefTried: false,
};

let model = null;
let pendingOtp = null;

/* ---------------- 模型 ---------------- */

/* 优先使用的模型：兼顾中文结构化输出的稳定性与速度 */
const PREFERRED_MODELS = [
  'deepseek-v4.1-flash',
  'glm-5.3-flash',
  'minimax-m3.1-flash',
  'hunyuan-chat',
];

async function getModel() {
  if (model) return model;
  const res = await cloud.llm.models.list();
  const list = (Array.isArray(res) ? res : (res && res.data) || [])
    .filter((m) => m && m.disabled !== true && m.enabled !== false);
  if (!list.length) throw new Error('当前没有可用的模型，请稍后再试。');
  model = PREFERRED_MODELS.map((id) => list.find((m) => m.id === id)).find(Boolean) || list[0];
  return model;
}

function parseJsonLoose(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

async function askJson(systemPrompt, userPrompt, onDelta) {
  const m = await getModel();
  let text = '';
  for await (const chunk of cloud.llm.chat.completions.create({
    model: m.id,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    stream: true,
    temperature: 0.4,
    response_format: { type: 'json_object' },
  })) {
    const d = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
    if (d && d.content) {
      text += d.content;
      if (onDelta) onDelta(d.content);
    }
  }
  return parseJsonLoose(text);
}

/* ---------------- 数据 ---------------- */

async function loadReadings() {
  const { data, error } = await cloud.database
    .from('readings')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  state.readings = data || [];
}

async function loadBriefings() {
  const { data, error } = await cloud.database
    .from('briefings')
    .select('*')
    .order('brief_date', { ascending: false })
    .limit(120);
  if (error) throw error;
  state.briefings = data || [];
}

async function saveReading(parsed, form) {
  const row = {
    title: form.title,
    source_type: form.type,
    source_name: form.source || null,
    raw_text: form.content,
    summary: str(parsed.summary),
    key_points: strList(parsed.key_points, 6),
    concepts: conceptList(parsed.concepts),
    quotes: strList(parsed.quotes, 3),
    questions: strList(parsed.questions, 3),
    tag: str(parsed.tag).slice(0, 8) || null,
    read_on: state.today,
    owner_name: state.user && state.user.name ? state.user.name : null,
  };
  const { data, error } = await cloud.database.from('readings').insert(row).select();
  if (error) throw error;
  return data && data[0];
}

async function saveBriefing(date, parsed, count) {
  const payload = {
    brief_date: date,
    headline: str(parsed.headline),
    digest: str(parsed.digest),
    threads: threadList(parsed.threads),
    residues: strList(parsed.residues, 4),
    next_seed: str(parsed.next_seed),
    reading_count: count,
    owner_name: state.user && state.user.name ? state.user.name : null,
  };
  const upd = await cloud.database.from('briefings').update(payload).eq('brief_date', date).select();
  if (upd.error) throw upd.error;
  if (upd.data && upd.data.length) return upd.data[0];
  const ins = await cloud.database.from('briefings').insert(payload).select();
  if (ins.error) throw ins.error;
  return ins.data && ins.data[0];
}

/* ---------------- 登录 ---------------- */

function showAuthError(msg) {
  el.authError.textContent = msg;
  el.authError.classList.remove('hidden');
}

function clearAuthError() {
  el.authError.classList.add('hidden');
}

let countdown = null;

async function sendCode() {
  const email = el.email.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return showAuthError('请输入有效的邮箱地址。');
  }
  clearAuthError();
  el.sendCodeBtn.disabled = true;
  el.sendCodeBtn.textContent = '发送中…';
  try {
    const sent = await cloud.auth.sendOtp({ email });
    if (sent.error) throw sent.error;
    pendingOtp = {
      email,
      verificationId: sent.data.verificationId,
      isExistingUser: sent.data.isExistingUser,
    };
    el.code.focus();
    let left = 45;
    el.sendCodeBtn.textContent = `${left}s`;
    clearInterval(countdown);
    countdown = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(countdown);
        el.sendCodeBtn.disabled = false;
        el.sendCodeBtn.textContent = '重新获取';
      } else {
        el.sendCodeBtn.textContent = `${left}s`;
      }
    }, 1000);
  } catch (e) {
    el.sendCodeBtn.disabled = false;
    el.sendCodeBtn.textContent = '获取验证码';
    showAuthError(errMsg(e));
  }
}

async function submitOtp(ev) {
  ev.preventDefault();
  const email = el.email.value.trim();
  const token = el.code.value.trim();
  if (!pendingOtp || pendingOtp.email !== email) {
    return showAuthError('请先为这个邮箱获取验证码。');
  }
  if (!token) return showAuthError('请输入验证码。');
  clearAuthError();
  el.enterBtn.disabled = true;
  el.enterBtn.textContent = '正在进入…';
  try {
    const done = await cloud.auth.verifyOtp({
      email: pendingOtp.email,
      verificationId: pendingOtp.verificationId,
      isExistingUser: pendingOtp.isExistingUser,
      token,
    });
    if (done.error) throw done.error;
    pendingOtp = null;
    state.user = (done.data && done.data.user) || {};
    await enterApp();
  } catch (e) {
    el.enterBtn.disabled = false;
    el.enterBtn.textContent = '进入';
    showAuthError(errMsg(e));
  }
}

/* ---------------- 启动 ---------------- */

function showAuth() {
  el.authView.classList.remove('hidden');
  el.mainView.classList.add('hidden');
}

async function normalStartup() {
  try {
    const { data: session, error } = await cloud.auth.getSession();
    if (error || !session) return showAuth();
    state.user = session.user || {};
    await enterApp();
  } catch (e) {
    showAuth();
    showAuthError(errMsg(e));
  }
}

/* 回调地址必须是站点根路径，但要把分享码等业务参数带过去 */
function buildRedirectTo() {
  const back = new URL(location.href);
  back.pathname = '/';
  for (const k of ['code', 'state', 'provider']) back.searchParams.delete(k);
  return back.toString();
}

async function wechatLogin() {
  el.wechatBtn.disabled = true;
  clearAuthError();
  try {
    const { data, error } = await cloud.auth.signInWithOAuth({
      provider: 'wechat',
      redirectTo: buildRedirectTo(),
    });
    if (error) throw error;
    location.assign(data.url);
  } catch (e) {
    el.wechatBtn.disabled = false;
    showAuthError(errMsg(e));
  }
}

async function boot() {
  if (sdkError) {
    showAuth();
    showAuthError(sdkError);
    return;
  }

  const url = new URL(location.href);
  const hasCallback = url.searchParams.has('code') || url.searchParams.has('error');

  /* 普通打开：先恢复会话 */
  if (!hasCallback) return normalStartup();

  /* 授权回调必须在任何登录判断之前处理，code 只能用一次 */
  const provider = url.searchParams.get('provider');
  if (provider !== 'wechat' && provider !== 'workbuddy') {
    showAuth();
    showAuthError('授权回调缺少有效的登录方式，请重新登录。');
    return;
  }
  const handler = provider === 'wechat'
    ? cloud.auth.handleWechatWebCallback
    : cloud.auth.handleWorkBuddyCallback;
  if (typeof handler !== 'function') {
    showAuth();
    showAuthError('暂时无法使用这种方式登录，请改用邮箱。');
    return;
  }

  const { data: session, error } = await handler.call(cloud.auth);
  if (error) {
    showAuth();
    showAuthError(errMsg(error));
    return;
  }
  if (session) {
    for (const k of ['code', 'state', 'provider']) url.searchParams.delete(k);
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    state.user = session.user || {};
    await enterApp();
  } else {
    await normalStartup();
  }
}

async function enterApp() {
  el.authView.classList.add('hidden');
  el.mainView.classList.remove('hidden');
  el.userLabel.textContent = (state.user && (state.user.name || state.user.email)) || '';

  try {
    await Promise.all([loadReadings(), loadBriefings()]);
  } catch (e) {
    toast(errMsg(e));
  }
  renderAll();
  await ensurePastBriefing();
}

/* ---------------- 渲染 ---------------- */

function renderAll() {
  renderHero();
  renderToday();
  renderSide();
  renderArchive();
}

function heroLabel(diff) {
  if (diff <= 0) return '今日简报';
  if (diff === 1) return '昨日简报';
  if (diff < 7) return `${diff} 天前的简报`;
  return '上一次的简报';
}

function renderHero() {
  const past = state.briefings.filter((b) => b.brief_date <= state.today);
  const b = past[0];
  if (!b) {
    el.hero.classList.add('hidden');
    el.hero.innerHTML = '';
    return;
  }

  const diff = dayDiff(b.brief_date, state.today);
  const threads = Array.isArray(b.threads) ? b.threads : [];
  const residues = strList(b.residues, 4);

  el.hero.innerHTML = `
    <div class="hero-eyebrow">
      <span class="hero-label">${esc(heroLabel(diff))}</span>
      <span class="hero-date">${esc(fmtCN(b.brief_date))} · ${b.reading_count || 0} 条</span>
    </div>
    <h1 class="hero-headline">${esc(b.headline || '')}</h1>
    <p class="hero-digest">${esc(b.digest || '')}</p>
    ${threads.length || residues.length ? `
      <div class="hero-grid">
        <div class="hero-block">
          <h3>串起来的线索</h3>
          ${threads.length
            ? threads.map((t) => `
                <div class="thread">
                  <div class="thread-title">${esc(t.title || '')}</div>
                  <div class="thread-body">${esc(t.body || '')}</div>
                </div>`).join('')
            : '<div class="thread-body">这几段之间没有明显的关系。</div>'}
        </div>
        <div class="hero-block">
          <h3>带回来的问题</h3>
          ${residues.length
            ? residues.map((r) => `<div class="residue">${esc(r)}</div>`).join('')
            : '<div class="thread-body">今天没有留下悬而未决的东西。</div>'}
        </div>
      </div>` : ''}
    ${b.next_seed ? `<p class="hero-seed"><span>明天的入口</span>${esc(b.next_seed)}</p>` : ''}
  `;
  el.hero.classList.remove('hidden');
}

function entryHtml(r) {
  const points = strList(r.key_points, 6);
  const concepts = Array.isArray(r.concepts) ? r.concepts : [];
  const quotes = strList(r.quotes, 3);
  const questions = strList(r.questions, 3);
  const hasMore = concepts.length || quotes.length || questions.length;

  const more = hasMore ? `
    <div class="entry-more hidden" data-more="${r.id}">
      ${quotes.length ? `<p class="sub-label">原话</p>${quotes.map((q) => `<p class="quote">${esc(q)}</p>`).join('')}` : ''}
      ${concepts.length ? `<p class="sub-label">概念</p>${concepts.map((c) => `<div class="concept"><b>${esc(c.term)}</b> <span>${esc(c.gloss)}</span></div>`).join('')}` : ''}
      ${questions.length ? `<p class="sub-label">没解决的</p>${questions.map((q) => `<div class="residue">${esc(q)}</div>`).join('')}` : ''}
    </div>` : '';

  return `
    <article class="entry">
      <div class="entry-head">
        <div style="min-width:0">
          <h3 class="entry-title">${esc(r.title)}</h3>
          <div class="entry-meta">
            <span class="pill">${esc(TYPE_LABEL[r.source_type] || '内容')}</span>
            ${r.tag ? `<span class="pill tag">${esc(r.tag)}</span>` : ''}
            ${r.source_name ? `<span>${esc(r.source_name)}</span>` : ''}
          </div>
        </div>
        <button class="del-btn" data-del="${r.id}" title="删除" aria-label="删除">×</button>
      </div>
      ${r.summary ? `<p class="entry-summary">${esc(r.summary)}</p>` : ''}
      ${points.length ? `<ul class="entry-points">${points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      ${more}
      ${hasMore ? `<button class="toggle-btn" data-toggle="${r.id}">展开原话与疑问</button>` : ''}
    </article>`;
}

function renderToday() {
  const rows = state.readings.filter((r) => r.read_on === state.today);
  el.todayCount.textContent = rows.length ? `${rows.length} 条` : '';
  el.todayList.innerHTML = rows.map(entryHtml).join('');
  el.todayEmpty.classList.toggle('hidden', rows.length > 0);
  el.closeDayBtn.disabled = rows.length === 0 || state.busy;
  el.closeDayHint.classList.toggle('hidden', rows.length > 0);
  if (!rows.length) {
    el.closeDayHint.textContent = '今天还没有条目，先贴一段进来。';
    el.closeDayHint.classList.remove('hidden');
  }
}

function computeStreak() {
  const dates = [...new Set(state.readings.map((r) => r.read_on))].sort().reverse();
  if (!dates.length) return { streak: 0, totalDays: dates.length };
  const set = new Set(dates);
  let cur = state.today;
  if (!set.has(cur)) {
    const y = shiftDate(cur, -1);
    if (!set.has(y)) return { streak: 0, totalDays: set.size };
    cur = y;
  }
  let n = 0;
  while (set.has(cur)) {
    n += 1;
    cur = shiftDate(cur, -1);
  }
  return { streak: n, totalDays: set.size };
}

function renderSide() {
  const rows = state.readings.filter((r) => r.read_on === state.today);
  const { streak, totalDays } = computeStreak();
  const words = rows.reduce((sum, r) => sum + (r.raw_text ? r.raw_text.length : 0), 0);

  el.streakNum.textContent = streak;
  el.todayNum.textContent = rows.length;
  el.todayWords.textContent = `${words.toLocaleString('zh-CN')} 字`;
  el.totalDays.textContent = `累计 ${totalDays} 天`;

  const tags = [...new Set(rows.map((r) => r.tag).filter(Boolean))];
  if (tags.length) {
    el.tagBox.classList.remove('hidden');
    el.tagList.innerHTML = tags.map((t) => `<span class="pill tag">${esc(t)}</span>`).join('');
  } else {
    el.tagBox.classList.add('hidden');
  }
}

function renderArchive() {
  const byDate = new Map();
  state.readings.forEach((r) => {
    if (!byDate.has(r.read_on)) byDate.set(r.read_on, []);
    byDate.get(r.read_on).push(r);
  });
  const briefMap = new Map(state.briefings.map((b) => [b.brief_date, b]));

  const dates = [...new Set([...byDate.keys(), ...briefMap.keys()])].sort().reverse();

  if (!dates.length) {
    el.archiveList.innerHTML = '';
    el.archiveEmpty.classList.remove('hidden');
    return;
  }
  el.archiveEmpty.classList.add('hidden');

  el.archiveList.innerHTML = dates.map((d) => {
    const rows = byDate.get(d) || [];
    const b = briefMap.get(d);
    return `
      <section class="day-block">
        <div class="day-head">
          <span class="day-date">${esc(fmtCN(d))}</span>
          <span class="day-count">${rows.length} 条</span>
        </div>
        ${b ? `
          <div class="brief-mini">
            <h3>${esc(b.headline || '')}</h3>
            <p>${esc(b.digest || '')}</p>
          </div>` : ''}
        ${rows.map((r) => `
          <div class="arch-item">
            <div class="arch-title">${esc(r.title)}</div>
            <div class="arch-sum">${esc(r.summary || '')}</div>
          </div>`).join('')}
      </section>`;
  }).join('');
}

/* ---------------- 遮罩 ---------------- */

function showOverlay(label) {
  el.overlayLabel.textContent = label;
  el.overlayText.textContent = '';
  el.overlay.classList.remove('hidden');
}

function hideOverlay() {
  el.overlay.classList.add('hidden');
  el.overlayText.textContent = '';
}

function overlayDelta(delta) {
  el.overlayText.textContent += delta;
  el.overlayText.scrollTop = el.overlayText.scrollHeight;
}

/* ---------------- 消化一段内容 ---------------- */

function composeError(msg) {
  if (!msg) {
    el.composeError.classList.add('hidden');
    el.composeError.textContent = '';
    return;
  }
  el.composeError.textContent = msg;
  el.composeError.classList.remove('hidden');
}

function digestPrompt(form, truncated) {
  return `标题：${form.title}
类型：${TYPE_LABEL[form.type] || '文章'}
出处：${form.source || '未注明'}
${truncated ? `（原文过长，以下只提供前 ${MAX_CHARS} 字）\n` : ''}
正文：
"""
${form.content}
"""

只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字。字段如下：
{
  "summary": "3 到 4 句话，说清这段内容到底在讲什么。要具体，包含关键判断。",
  "key_points": ["3 到 5 条核心论点，每条一句话，是判断而不是话题名"],
  "concepts": [{"term": "关键概念", "gloss": "一句话解释，用读者能懂的话"}],
  "quotes": ["1 到 3 句原文中最值得留下的句子，必须是原文原话"],
  "questions": ["1 到 3 个这段内容没有回答、或者值得继续追问的问题"],
  "tag": "2 到 6 个字，给这段内容一个主题标签"
}`;
}

async function digestCurrent() {
  if (state.busy) return;
  const form = {
    title: el.title.value.trim(),
    type: el.type.value,
    source: el.source.value.trim(),
    content: el.content.value.trim(),
  };
  if (!form.title) return composeError('先给它一个标题。');
  if (form.content.length < 40) return composeError('正文太短了，至少贴一段完整的话。');
  composeError('');

  const truncated = form.content.length > MAX_CHARS;
  const body = truncated ? form.content.slice(0, MAX_CHARS) : form.content;

  state.busy = true;
  el.digestBtn.disabled = true;
  el.digestBtn.textContent = '在读…';
  el.streamBox.classList.remove('hidden');
  el.streamLabel.textContent = '正在消化';
  el.streamText.textContent = '';

  try {
    const parsed = await askJson(
      DIGEST_SYSTEM,
      digestPrompt({ ...form, content: body }, truncated),
      (d) => {
        el.streamText.textContent += d;
        el.streamText.scrollTop = el.streamText.scrollHeight;
      },
    );
    if (!parsed) throw new Error('这次没能读成，请再点一次「读一遍」。');

    const saved = await saveReading(parsed, form);
    if (!saved) throw new Error('没有保存成功，请再试一次。');

    el.title.value = '';
    el.source.value = '';
    el.content.value = '';
    el.charCount.textContent = '0 字';

    await loadReadings();
    renderToday();
    renderSide();
    renderArchive();
    toast('记住了。');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    composeError(errMsg(e));
  } finally {
    state.busy = false;
    el.digestBtn.disabled = false;
    el.digestBtn.textContent = '读一遍';
    el.streamBox.classList.add('hidden');
    el.streamText.textContent = '';
  }
}

/* ---------------- 收束一天 ---------------- */

function briefPrompt(date, rows) {
  const items = rows.map((r, i) => {
    const kp = strList(r.key_points, 6);
    const qs = strList(r.questions, 3);
    return [
      `${i + 1}. 《${r.title}》（${TYPE_LABEL[r.source_type] || '文章'}${r.source_name ? ' · ' + r.source_name : ''}）`,
      `   摘要：${r.summary || '（无）'}`,
      kp.length ? `   要点：\n${kp.map((s) => '     · ' + s).join('\n')}` : '',
      qs.length ? `   留下的疑问：\n${qs.map((s) => '     · ' + s).join('\n')}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return `日期：${date}
这一天读了 ${rows.length} 段内容：

${items}

只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字。字段如下：
{
  "headline": "一句话概括今天读了什么，不超过 22 字，要像标题，不要像总结",
  "digest": "4 到 6 句话，讲清今天这一天的阅读整体上把你带到了哪里。几段内容之间存在呼应、张力或重复，直接指出来。",
  "threads": [{"title": "线索名，3 到 8 字", "body": "2 到 3 句，说明这条线索串起了哪几段、为什么"}],
  "residues": ["2 到 3 条，今天没消化完、值得明天带回来的东西。要具体到内容，不要写「继续思考」"],
  "next_seed": "一句话：明天打开时可以从哪里接着读。要具体、可执行。"
}`;
}

async function closeDay() {
  if (state.busy) return;
  const rows = state.readings.filter((r) => r.read_on === state.today);
  if (!rows.length) return toast('今天还没有条目。');

  state.busy = true;
  el.closeDayBtn.disabled = true;
  showOverlay('正在把今天串起来');
  try {
    const parsed = await askJson(BRIEF_SYSTEM, briefPrompt(state.today, rows), overlayDelta);
    if (!parsed) throw new Error('这次没能写成，请再点一次。');
    await saveBriefing(state.today, parsed, rows.length);
    await loadBriefings();
    renderHero();
    toast('简报写好了。明天打开，它就在最上面。');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    toast(errMsg(e));
  } finally {
    state.busy = false;
    el.closeDayBtn.disabled = false;
    hideOverlay();
  }
}

async function ensurePastBriefing() {
  if (state.pastBriefTried || state.busy) return;
  const pastDates = [...new Set(
    state.readings.filter((r) => r.read_on < state.today).map((r) => r.read_on),
  )].sort().reverse();
  if (!pastDates.length) return;

  const day = pastDates[0];
  if (state.briefings.some((b) => b.brief_date === day)) return;

  const rows = state.readings.filter((r) => r.read_on === day);
  if (!rows.length) return;

  state.pastBriefTried = true;
  showOverlay(`正在补写 ${fmtCN(day)} 的简报`);
  try {
    const parsed = await askJson(BRIEF_SYSTEM, briefPrompt(day, rows), overlayDelta);
    if (parsed) {
      await saveBriefing(day, parsed, rows.length);
      await loadBriefings();
      renderHero();
    }
  } catch (e) {
    toast('上一次的简报没能补上，稍后可以手动生成。');
  } finally {
    hideOverlay();
  }
}

/* ---------------- 删除 ---------------- */

async function deleteReading(id) {
  const ok = window.confirm('删掉这一条？删了就找不回来了。');
  if (!ok) return;
  const { data, error } = await cloud.database.from('readings').delete().eq('id', id).select();
  if (error) return toast(errMsg(error));
  if (!data || !data.length) return toast('没有删掉，可能它已经不存在了。');
  await loadReadings();
  renderToday();
  renderSide();
  renderArchive();
  toast('删掉了。');
}

/* ---------------- 事件 ---------------- */

function bindEvents() {
  el.wechatBtn.addEventListener('click', wechatLogin);
  el.sendCodeBtn.addEventListener('click', sendCode);
  el.authForm.addEventListener('submit', submitOtp);

  el.content.addEventListener('input', () => {
    const n = el.content.value.trim().length;
    el.charCount.textContent = n ? `${n.toLocaleString('zh-CN')} 字` : '0 字';
  });

  el.digestBtn.addEventListener('click', digestCurrent);
  el.closeDayBtn.addEventListener('click', closeDay);

  el.todayList.addEventListener('click', (ev) => {
    const del = ev.target.closest('[data-del]');
    if (del) return deleteReading(Number(del.getAttribute('data-del')));

    const tg = ev.target.closest('[data-toggle]');
    if (tg) {
      const id = tg.getAttribute('data-toggle');
      const box = el.todayList.querySelector(`[data-more="${id}"]`);
      if (!box) return;
      const open = !box.classList.contains('hidden');
      box.classList.toggle('hidden', open);
      tg.textContent = open ? '展开原话与疑问' : '收起';
    }
  });

  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      state.view = view;
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
      el.todayView.classList.toggle('hidden', view !== 'today');
      el.archiveView.classList.toggle('hidden', view !== 'archive');
      if (view === 'archive') renderArchive();
      window.scrollTo({ top: 0 });
    });
  });

  el.signOutBtn.addEventListener('click', async () => {
    try {
      await cloud.auth.signOut();
    } catch (e) {
      /* 忽略：无论成功与否都回到登录页 */
    }
    location.reload();
  });

  if (typeof cloud.auth.onAuthStateChange === 'function') {
    cloud.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') location.reload();
    });
  }
}

/* ---------------- 起飞 ---------------- */

bindEvents();
boot();
