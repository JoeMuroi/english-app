// ============================================================
// APP.JS  –  Arrow keys + Enter navigation
// ============================================================

// ── Speech ───────────────────────────────────────────────────
const synth = window.speechSynthesis || null;
let _voices = [];

if (synth) {
  const _loadVoices = () => {
    const v = synth.getVoices();
    if (v.length) _voices = v;
  };
  _loadVoices();
  synth.onvoiceschanged = _loadVoices;

  // iOS Safari: unlock audio on first user gesture
  let _unlocked = false;
  const _unlock = () => {
    if (_unlocked) return;
    _unlocked = true;
    try {
      const u = new SpeechSynthesisUtterance('');
      synth.speak(u);
      _loadVoices();
    } catch(e) {}
    document.removeEventListener('touchstart', _unlock);
    document.removeEventListener('click',      _unlock);
  };
  document.addEventListener('touchstart', _unlock, { passive: true });
  document.addEventListener('click',      _unlock);
}

function speak(text) {
  return new Promise(resolve => {
    if (!synth) { resolve(); return; }
    try {
      synth.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang  = 'en-US';
      utt.rate  = 1.1;
      utt.pitch = 1;
      const usVoice = _voices.find(v => v.lang === 'en-US') ||
                      _voices.find(v => v.lang.startsWith('en'));
      if (usVoice) utt.voice = usVoice;
      utt.onend = resolve; utt.onerror = resolve;
      synth.speak(utt);
    } catch(e) { resolve(); }
  });
}

// ── Toast ─────────────────────────────────────────────────────
const toastEl = document.getElementById('toast');
let toastTimer;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

// ── Key hint ──────────────────────────────────────────────────
const keyHint = document.getElementById('key-hint');
function kb(key, label) {
  return `<span class="kb"><span class="kbd">${key}</span>${label}</span>`;
}
const HINT_BASE = kb('↑↓←→', '移動') + kb('Enter', '決定');

// ── Cursor (arrow + Enter navigation) ────────────────────────
//
//  each item: { el, action, nav: { up, down, left, right } }
//  nav values are indices into the items array; same index = no move
//
const cur = {
  pos: 0,
  items: [],

  set(items, startPos = 0) {
    this.clear();
    this.items = items;
    this.pos = startPos;
    if (items.length) items[startPos].el.classList.add('kb-focus');
  },

  move(dir) {
    if (!this.items.length) return;
    const nav = this.items[this.pos]?.nav;
    if (!nav || nav[dir] === undefined) return;
    const next = nav[dir];
    if (next === this.pos) return;
    this.items[this.pos].el.classList.remove('kb-focus');
    this.pos = next;
    this.items[this.pos].el.classList.add('kb-focus');
    this.items[this.pos].el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  },

  enter() {
    this.items[this.pos]?.action?.();
  },

  clear() {
    this.items.forEach(i => i.el?.classList.remove('kb-focus'));
    this.items = [];
    this.pos = 0;
  }
};

// Global keydown: ONLY arrow keys and Enter
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const dirMap = { ArrowUp:'up', ArrowDown:'down', ArrowLeft:'left', ArrowRight:'right' };
  if (e.key in dirMap) { e.preventDefault(); cur.move(dirMap[e.key]); return; }
  if (e.key === 'Enter') { e.preventDefault(); cur.enter(); }
});

// ── Router ────────────────────────────────────────────────────
const container = document.getElementById('view-container');
const navBtns   = document.querySelectorAll('.nav-btn');

navBtns.forEach(btn => btn.addEventListener('click', () => navigateTo(btn.dataset.view)));

function navigateTo(name) {
  window.speechSynthesis.cancel();
  cur.clear();
  navBtns.forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-view="${name}"]`)?.classList.add('active');
  document.querySelectorAll('.mastery-tooltip').forEach(t => t.remove());
  switch (name) {
    case 'home':     renderHome(); break;
    case 'test':     renderTestStart(); break;
    case 'weaklist': renderWeakList(); break;
    case 'mastery':  renderMastery(); break;
    case 'badges':   renderBadges(); break;
    case 'review':   renderBookmarkList(); break;
  }
}

// ── HOME ──────────────────────────────────────────────────────
async function renderHome() {
  const state   = await DB.getUserState();
  const records = await DB.getAllItemRecords();
  const total   = window.ITEMS.length;
  const seen    = records.filter(r => r.lastSeen !== null).length;
  const mastered = records.filter(r => {
    const t = r.correct + r.incorrect;
    return t > 0 && r.correct / t >= 0.85 && r.streak >= 3;
  }).length;

  const curLvlXP  = DB.xpForLevel(state.level);
  const nextLvlXP = DB.xpForLevel(state.level + 1);
  const pct = Math.max(0, Math.min(100, Math.round(
    (state.xp - curLvlXP) / (nextLvlXP - curLvlXP) * 100
  )));

  container.innerHTML = `
    <div class="home-header">
      <h1>🎧 English Listening Master</h1>
      <p>ネイティブ英語を聞いて理解できるようになろう</p>
    </div>

    ${state.streak >= 2 ? `
    <div class="streak-banner">
      <span class="fire">🔥</span>
      <span><strong>${state.streak}日連続</strong>プレイ中！この調子を続けよう</span>
    </div>` : ''}

    <div class="stats-grid">
      <div class="stat-card"><div class="val">${state.level}</div><div class="lbl">レベル</div></div>
      <div class="stat-card"><div class="val">${seen}</div><div class="lbl">学習済み / ${total}</div></div>
      <div class="stat-card"><div class="val">${mastered}</div><div class="lbl">習得済み</div></div>
    </div>

    <div class="level-bar-wrap card">
      <div class="level-label">
        <span>Lv.${state.level} → Lv.${state.level + 1}</span>
        <span>${state.xp} XP</span>
      </div>
      <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
    </div>

    <button class="btn-primary" id="start-btn">🎧 テストを始める（30問）</button>

    <div class="card" style="margin-top:16px">
      <div class="section-title">📈 今日の目標</div>
      <p style="color:var(--text2);font-size:14px">
        1日1セッション（30問）で習熟度がぐんぐん上がります。<br>
        苦手な単語は自動的に繰り返し出題されます。
      </p>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="section-title">📲 データの引き継ぎ</div>
      <p style="color:var(--text2);font-size:13px;margin-bottom:10px">
        スマホ↔PCなど、別の端末に学習データを移すときに使います。
      </p>
      <div class="data-actions">
        <button class="btn-secondary" id="export-btn">📤 エクスポート</button>
        <button class="btn-secondary" id="import-btn">📥 インポート</button>
      </div>
      <div id="export-area" style="display:none;margin-top:10px">
        <textarea id="export-text" readonly
          style="width:100%;height:120px;resize:vertical;padding:8px;border-radius:6px;
                 background:var(--surface);color:var(--text);border:1px solid var(--surface2);
                 font-size:11px;font-family:monospace;box-sizing:border-box"></textarea>
        <p style="font-size:12px;color:var(--text2);margin-top:6px">
          ↑ 全選択してコピーし、移行先でインポートしてください
        </p>
      </div>
      <div id="import-area" style="display:none;margin-top:10px">
        <textarea id="import-text" placeholder="コピーしたデータをここに貼り付けてください"
          style="width:100%;height:120px;resize:vertical;padding:8px;border-radius:6px;
                 background:var(--surface);color:var(--text);border:1px solid var(--surface2);
                 font-size:11px;font-family:monospace;box-sizing:border-box"></textarea>
        <button class="btn-primary" id="import-ok-btn" style="margin-top:8px;width:100%">
          インポートを実行
        </button>
      </div>
      <p id="transfer-msg" style="font-size:13px;margin-top:8px;display:none"></p>
    </div>
  `;

  const startBtn  = document.getElementById('start-btn');
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const exportArea = document.getElementById('export-area');
  const importArea = document.getElementById('import-area');
  const transferMsg = document.getElementById('transfer-msg');

  startBtn.addEventListener('click', () => navigateTo('test'));

  exportBtn.addEventListener('click', async () => {
    importArea.style.display = 'none';
    try {
      const json = await DB.exportData();
      document.getElementById('export-text').value = json;
      exportArea.style.display = exportArea.style.display === 'none' ? 'block' : 'none';
      if (exportArea.style.display === 'block') {
        document.getElementById('export-text').select();
      }
      transferMsg.style.display = 'none';
    } catch(e) {
      transferMsg.textContent = '❌ エクスポートに失敗しました: ' + e.message;
      transferMsg.style.color = 'var(--danger)';
      transferMsg.style.display = 'block';
    }
  });

  importBtn.addEventListener('click', () => {
    exportArea.style.display = 'none';
    importArea.style.display = importArea.style.display === 'none' ? 'block' : 'none';
    transferMsg.style.display = 'none';
  });

  document.getElementById('import-ok-btn')?.addEventListener('click', async () => {
    const text = document.getElementById('import-text').value.trim();
    if (!text) return;
    try {
      await DB.importData(text);
      transferMsg.textContent = '✅ インポート完了！ページを再読み込みします…';
      transferMsg.style.color = 'var(--success)';
      transferMsg.style.display = 'block';
      setTimeout(() => location.reload(), 1500);
    } catch(e) {
      transferMsg.textContent = '❌ インポートに失敗しました: ' + e.message;
      transferMsg.style.color = 'var(--danger)';
      transferMsg.style.display = 'block';
    }
  });

  // Cursor: start button only (export/import use tap/click)
  cur.set([{ el: startBtn, action: () => navigateTo('test'),
    nav: { up:0, down:0, left:0, right:0 } }]);

  keyHint.innerHTML = HINT_BASE;
}

// ── TEST ──────────────────────────────────────────────────────
let session = null;

function renderTestStart() {
  container.innerHTML = `
    <div style="text-align:center;padding:40px 16px">
      <div style="font-size:48px;margin-bottom:16px">🎧</div>
      <h2 style="margin-bottom:8px">リスニングテスト</h2>
      <p style="color:var(--text2);margin-bottom:24px">音声を聞いて正しい選択肢を選んでください</p>
      <div class="card" style="text-align:left;margin-bottom:24px">
        <p style="font-size:14px;color:var(--text2);line-height:1.8">
          ✅ 1セッション30問<br>
          ✅ 苦手な項目を優先出題<br>
          ✅ 正解するほどXP獲得
        </p>
      </div>
      <button class="btn-primary" id="go-btn">スタート！</button>
    </div>
  `;
  const goBtn = document.getElementById('go-btn');
  goBtn.addEventListener('click', startSession);

  cur.set([{ el: goBtn, action: startSession,
    nav: { up:0, down:0, left:0, right:0 } }]);
  keyHint.innerHTML = HINT_BASE;
}

async function startSession() {
  cur.clear();
  keyHint.innerHTML = '';
  const questions = await DB.selectQuestions(window.ITEMS, 30);
  session = { questions, current: 0, score: 0, answers: [] };
  renderQuestion();
}

async function renderQuestion() {
  cur.clear();
  if (session.current >= session.questions.length) { renderResult(); return; }

  const item  = session.questions[session.current];
  const qNum  = session.current + 1;
  const total = session.questions.length;
  const pct   = Math.round((session.current / total) * 100);

  const sameType = window.ITEMS.filter(i => i.type === item.type && i.id !== item.id);
  const choices  = [...sameType.sort(() => Math.random() - 0.5).slice(0, 3), item]
                    .sort(() => Math.random() - 0.5);

  container.innerHTML = `
    <div class="test-progress">
      <span>${qNum} / ${total}　<span style="color:var(--text2);font-size:11px">（10フレーズ × 3回）</span></span>
      <span>${session.score} 正解</span>
    </div>
    <div class="test-progress-bar">
      <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
    </div>

    <div class="card">
      <button class="audio-btn pulse" id="play-btn">
        <span id="play-icon">▶</span>
        <span>タップして音声を再生</span>
      </button>

      <div class="choices" id="choices">
        ${choices.map(c => `
          <button class="choice-btn" data-id="${c.id}" data-correct="${c.id === item.id}">
            ${c.en}
          </button>
        `).join('')}
      </div>

      <div id="feedback"></div>
    </div>
  `;

  // Audio button
  const playBtn = document.getElementById('play-btn');
  function startPlay() {
    playBtn.classList.remove('pulse');
    playBtn.classList.add('playing');
    playBtn.querySelector('#play-icon').textContent = '🔊';
    speak(item.en).then(() => {
      if (playBtn.isConnected) {
        playBtn.classList.remove('playing');
        playBtn.querySelector('#play-icon').textContent = '▶';
      }
    });
  }
  // ※ iOS Safari では自動再生不可のため、ユーザーのタップを待つ
  playBtn.addEventListener('click', startPlay);

  // Choice buttons
  const choiceBtns = [...document.querySelectorAll('.choice-btn')];
  choiceBtns.forEach(btn => btn.addEventListener('click', () => handleAnswer(btn, item)));

  // ── Cursor layout ─────────────────────────────────────────
  //  idx 0 : audio button
  //  idx 1 : choice[0]  (row 0, col 0)
  //  idx 2 : choice[1]  (row 0, col 1)
  //  idx 3 : choice[2]  (row 1, col 0)
  //  idx 4 : choice[3]  (row 1, col 1)
  //
  //  Grid visual:
  //    [  audio  (0)  ]
  //    [ c0(1) ][ c1(2) ]
  //    [ c2(3) ][ c3(4) ]
  //
  cur.set([
    { el: playBtn,       action: startPlay,
      nav: { up:0, down:1, left:0, right:0 } },
    { el: choiceBtns[0], action: () => choiceBtns[0].click(),
      nav: { up:0, down:3, left:1, right:2 } },
    { el: choiceBtns[1], action: () => choiceBtns[1].click(),
      nav: { up:0, down:4, left:1, right:2 } },
    { el: choiceBtns[2], action: () => choiceBtns[2].click(),
      nav: { up:1, down:3, left:3, right:4 } },
    { el: choiceBtns[3], action: () => choiceBtns[3].click(),
      nav: { up:2, down:4, left:3, right:4 } },
  ]);

  keyHint.innerHTML = HINT_BASE +
    kb('↓ (音声ボタンから)', '選択肢へ移動');
}

async function handleAnswer(chosenBtn, item) {
  cur.clear();
  const isCorrect = chosenBtn.dataset.correct === 'true';

  document.querySelectorAll('.choice-btn').forEach(b => {
    b.disabled = true;
    if (b.dataset.correct === 'true') b.classList.add('correct');
    if (b === chosenBtn && !isCorrect) b.classList.add('wrong');
  });

  await DB.recordAnswer(item.id, isCorrect);
  if (isCorrect) session.score++;
  session.answers.push({ id: item.id, isCorrect });

  const fb = document.getElementById('feedback');
  fb.className = `feedback-box ${isCorrect ? 'correct' : 'wrong'}`;
  fb.innerHTML = `
    <div class="en">${isCorrect ? '✅' : '❌'} ${item.en}</div>
    <div class="ja">${item.ja}</div>
    ${!isCorrect ? `<div style="margin-top:6px;font-size:12px;color:var(--text2)">もう一度聞いてみよう</div>` : ''}
  `;

  // 不正解時: 自動再生はiOSでブロックされるため、ボタンで再生する
  if (!isCorrect) speak(item.en);

  // Bookmark button
  const bookmarkBtn = document.createElement('button');
  bookmarkBtn.className = 'bookmark-btn';
  const currentlyBookmarked = await DB.isBookmarked(item.id);
  bookmarkBtn.classList.toggle('active', currentlyBookmarked);
  bookmarkBtn.innerHTML = currentlyBookmarked
    ? '⭐ 復習リストから外す'
    : '☆ 復習リストに追加';
  bookmarkBtn.addEventListener('click', async () => {
    const next = await DB.toggleBookmark(item.id);
    bookmarkBtn.classList.toggle('active', next);
    bookmarkBtn.innerHTML = next ? '⭐ 復習リストから外す' : '☆ 復習リストに追加';
  });
  fb.appendChild(bookmarkBtn);

  const isLast = session.current + 1 >= session.questions.length;
  const nextBtn = document.createElement('button');
  nextBtn.className = 'next-btn';
  nextBtn.id = 'next-q-btn';
  nextBtn.textContent = isLast ? '結果を見る' : '次の問題 →';
  nextBtn.addEventListener('click', () => { session.current++; renderQuestion(); });
  fb.appendChild(nextBtn);

  // Cursor: bookmark(0) → next(1)
  cur.set([
    { el: bookmarkBtn, action: () => bookmarkBtn.click(),
      nav: { up:0, down:1, left:0, right:0 } },
    { el: nextBtn,     action: () => { session.current++; renderQuestion(); },
      nav: { up:0, down:1, left:1, right:1 } },
  ]);

  keyHint.innerHTML = HINT_BASE;
}

async function renderResult() {
  cur.clear();
  window.speechSynthesis.cancel();

  // 今回使ったチャンクIDを保存 → 次セッションで除外
  const usedIds = [...new Set(session.questions.map(q => q.id))];
  await DB.saveLastSessionChunkIds(usedIds).catch(() => {});

  let state, xpGained, newBadges;
  try {
    ({ state, xpGained, newBadges } = await DB.afterSession(session.score, session.questions.length));
  } catch (err) {
    console.error('afterSession failed:', err);
    state     = await DB.getUserState().catch(() => ({ level:1, xp:0, streak:1 }));
    xpGained  = 0;
    newBadges = [];
  }

  const pct = Math.round(session.score / session.questions.length * 100);
  const msg =
    pct === 100 ? '🎉 完璧！素晴らしい！' :
    pct >= 80   ? '👍 よくできました！' :
    pct >= 60   ? '💪 もう少し！続けよう' :
                  '📚 復習が必要ですが、続けることが大事！';

  container.innerHTML = `
    <div class="result-screen card">
      <div class="result-score">${session.score}<span> / ${session.questions.length}</span></div>
      <div class="result-msg">${msg}</div>

      <div class="stats-grid" style="margin-bottom:20px">
        <div class="stat-card">
          <div class="val" style="color:var(--warning)">+${xpGained}</div>
          <div class="lbl">XP 獲得</div>
        </div>
        <div class="stat-card">
          <div class="val">${state.level}</div>
          <div class="lbl">レベル</div>
        </div>
        <div class="stat-card">
          <div class="val">🔥 ${state.streak}</div>
          <div class="lbl">連続日数</div>
        </div>
      </div>

      ${newBadges.length > 0 ? `
        <div style="margin-bottom:20px">
          <div class="section-title">🏅 新しいバッジ獲得！</div>
          <div class="result-badges">
            ${newBadges.map(b => `<span class="result-badge">${b.icon} ${b.name}</span>`).join('')}
          </div>
        </div>
      ` : ''}

      <button class="btn-primary" id="again-btn">もう1回</button>
      <button class="next-btn" id="home-btn" style="margin-top:10px">ホームに戻る</button>
    </div>
  `;

  // Attach mouse listeners
  const againBtn = document.getElementById('again-btn');
  const homeBtn  = document.getElementById('home-btn');
  againBtn.addEventListener('click', () => startSession());
  homeBtn.addEventListener('click',  () => navigateTo('home'));

  newBadges.forEach(b => showToast(`🏅 バッジ獲得: ${b.icon} ${b.name}`));

  // Cursor: again(0) ↔ home(1) via ↑↓
  cur.set([
    { el: againBtn, action: () => startSession(),
      nav: { up:0, down:1, left:0, right:0 } },
    { el: homeBtn,  action: () => navigateTo('home'),
      nav: { up:0, down:1, left:1, right:1 } },
  ]);

  keyHint.innerHTML = HINT_BASE;
}

// ── WEAK LIST ────────────────────────────────────────────────
async function renderWeakList() {
  cur.clear();
  keyHint.innerHTML = '';
  const weakItems = await DB.getWeakItems(50);

  function renderList(type) {
    const items = type === 'all' ? weakItems : weakItems.filter(w => w.item.type === type);
    if (!items.length) {
      return `<div class="empty-state"><div class="icon">🎉</div><p>苦手な項目はありません！</p></div>`;
    }
    return items.map(w => `
      <div class="weak-item">
        <div>
          <div class="weak-en">${w.item.en}</div>
          <div class="weak-ja">${w.item.ja}</div>
        </div>
        <div style="display:flex;align-items:center">
          <div class="weak-rate">${Math.round(w.accuracy * 100)}%</div>
          <button class="speak-btn" data-text="${w.item.en}">🔊</button>
        </div>
      </div>
    `).join('');
  }

  container.innerHTML = `
    <div class="section-title">⚡ 苦手リスト</div>
    <div class="filter-tabs">
      <button class="filter-tab active" data-type="all">すべて</button>
      <button class="filter-tab" data-type="word">単語</button>
      <button class="filter-tab" data-type="chunk">チャンク</button>
    </div>
    <div class="card" id="weak-body">
      ${!weakItems.length
        ? `<div class="empty-state"><div class="icon">📚</div><p>テストをすると苦手な単語が表示されます</p></div>`
        : renderList('all')}
    </div>
  `;

  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('weak-body').innerHTML = renderList(tab.dataset.type);
      bindSpeakBtns();
    });
  });
  bindSpeakBtns();
}

function bindSpeakBtns() {
  document.querySelectorAll('.speak-btn').forEach(btn => {
    btn.addEventListener('click', () => speak(btn.dataset.text));
  });
}

// ── BOOKMARK / REVIEW LIST ───────────────────────────────────
async function renderBookmarkList() {
  cur.clear();
  keyHint.innerHTML = '';

  const bookmarked = await DB.getBookmarkedItems();
  const itemMap = {};
  window.ITEMS.forEach(i => itemMap[i.id] = i);
  const items = bookmarked.map(r => itemMap[r.id]).filter(Boolean);
  const count = items.length;

  container.innerHTML = `
    <div class="section-title">⭐ 復習リスト</div>
    ${count === 0 ? `
      <div class="empty-state">
        <div class="icon">⭐</div>
        <p>復習したいフレーズに ☆ を付けると<br>ここに追加されます</p>
        <p style="font-size:12px;margin-top:8px;color:var(--text2)">
          テスト中の回答後に「☆ 復習リストに追加」で登録できます
        </p>
      </div>
    ` : `
      <button class="btn-primary" id="review-start-btn" style="margin-bottom:16px">
        🎧 復習テストを始める（${Math.min(count, 30)}問）
      </button>
      <div class="card">
        ${items.map(item => `
          <div class="weak-item">
            <div>
              <div class="weak-en">${item.en}</div>
              <div class="weak-ja">${item.ja}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <button class="speak-btn" data-text="${item.en}">🔊</button>
              <button class="unbookmark-btn" data-id="${item.id}" title="リストから外す">✕</button>
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;

  if (count > 0) {
    const startBtn = document.getElementById('review-start-btn');
    startBtn.addEventListener('click', startReviewSession);
    cur.set([{ el: startBtn, action: startReviewSession,
      nav: { up:0, down:0, left:0, right:0 } }]);
    keyHint.innerHTML = HINT_BASE;
  }

  bindSpeakBtns();

  document.querySelectorAll('.unbookmark-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      await DB.toggleBookmark(btn.dataset.id);
      renderBookmarkList();
    });
  });
}

async function startReviewSession() {
  cur.clear();
  keyHint.innerHTML = '';
  const questions = await DB.selectBookmarkQuestions(window.ITEMS);
  if (!questions.length) { showToast('復習リストが空です'); return; }

  navBtns.forEach(b => b.classList.remove('active'));
  document.querySelector('[data-view="test"]')?.classList.add('active');
  session = { questions, current: 0, score: 0, answers: [] };
  renderQuestion();
}

// ── MASTERY MAP ──────────────────────────────────────────────
async function renderMastery() {
  cur.clear();
  keyHint.innerHTML = '';
  const masteryMap = await DB.getMasteryMap();
  const allItems   = window.ITEMS;

  const tooltip = document.createElement('div');
  tooltip.className = 'mastery-tooltip';
  document.body.appendChild(tooltip);

  const counts = [0,0,0,0,0,0];
  allItems.forEach(item => counts[masteryMap[item.id] || 0]++);

  const labels = ['未学習','入門','初級','中級','上級','習得'];
  const colors = ['var(--surface2)','#1d4ed8','#0369a1','#0e7490','#047857','var(--success)'];

  container.innerHTML = `
    <div class="section-title">📊 習熟度マップ</div>
    <div class="mastery-legend">
      ${labels.map((l,i) => `
        <span>
          <span class="legend-dot" style="background:${colors[i]}"></span>
          ${l}（${counts[i]}）
        </span>
      `).join('')}
    </div>
    <div class="card">
      <p style="font-size:13px;color:var(--text2);margin-bottom:12px">
        全 ${allItems.length} 項目 ｜ 習得: ${counts[5]} (${Math.round(counts[5]/allItems.length*100)}%)
      </p>
      <div class="mastery-grid" id="mastery-grid"></div>
    </div>
  `;

  const grid = document.getElementById('mastery-grid');
  allItems.forEach(item => {
    const lvl  = masteryMap[item.id] || 0;
    const cell = document.createElement('div');
    cell.className = 'mastery-cell';
    cell.dataset.level = lvl;
    grid.appendChild(cell);
    cell.addEventListener('mousemove', e => {
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX + 12) + 'px';
      tooltip.style.top  = (e.clientY + 12) + 'px';
      tooltip.innerHTML = `<strong>${item.en}</strong><br>
        <span style="color:var(--text2)">${item.ja}</span><br>
        <span style="color:${colors[lvl]}">${labels[lvl]}</span>`;
    });
    cell.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    cell.addEventListener('click', () => speak(item.en));
  });
}

// ── BADGES ───────────────────────────────────────────────────
async function renderBadges() {
  cur.clear();
  keyHint.innerHTML = '';
  const state = await DB.getUserState();
  const defs  = DB.BADGE_DEFS;

  container.innerHTML = `
    <div class="section-title">🏆 バッジ</div>
    <p style="color:var(--text2);font-size:13px;margin-bottom:16px">
      ${state.badges.length} / ${defs.length} 獲得済み
    </p>
    <div class="badges-grid">
      ${defs.map(b => {
        const unlocked = state.badges.includes(b.id);
        return `<div class="badge-card ${unlocked ? 'unlocked' : 'locked'}">
          <div class="badge-icon">${b.icon}</div>
          <div class="badge-name">${b.name}</div>
          <div class="badge-desc">${b.desc}</div>
        </div>`;
      }).join('')}
    </div>
  `;
}

// ── INIT ─────────────────────────────────────────────────────
async function init() {
  await DB.initDB();
  renderHome();
}

init();
