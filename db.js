// ============================================================
// DB.JS  –  IndexedDB wrapper + SRS logic
// ============================================================

const DB_NAME = 'EnglishApp';
const DB_VER  = 1;

// SRS intervals in days: index = correct streak
const INTERVALS = [1, 2, 4, 8, 16, 32, 64];

let _db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('items')) {
        const store = db.createObjectStore('items', { keyPath: 'id' });
        store.createIndex('nextReview', 'nextReview', { unique: false });
      }
      if (!db.objectStoreNames.contains('user')) {
        db.createObjectStore('user', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
      }
    };

    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return _db.transaction(storeName, mode).objectStore(storeName);
}

// ── Generic helpers ─────────────────────────────────────────
function dbGet(store, key) {
  return new Promise((res, rej) => {
    const r = tx(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}
function dbPut(store, obj) {
  return new Promise((res, rej) => {
    const r = tx(store, 'readwrite').put(obj);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}
function dbGetAll(store) {
  return new Promise((res, rej) => {
    const r = tx(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}

// ── Item records ────────────────────────────────────────────
async function getItemRecord(id) {
  return await dbGet('items', id);
}

async function ensureItemRecord(item) {
  let rec = await getItemRecord(item.id);
  if (!rec) {
    rec = {
      id: item.id,
      correct: 0,
      incorrect: 0,
      streak: 0,           // consecutive correct answers
      nextReview: Date.now(),
      lastSeen: null,
    };
    await dbPut('items', rec);
  }
  return rec;
}

async function recordAnswer(itemId, isCorrect) {
  let rec = await getItemRecord(itemId);
  if (!rec) rec = { id: itemId, correct: 0, incorrect: 0, streak: 0, nextReview: Date.now(), lastSeen: null };

  rec.lastSeen = Date.now();
  if (isCorrect) {
    rec.correct++;
    rec.streak = Math.min(rec.streak + 1, INTERVALS.length - 1);
  } else {
    rec.incorrect++;
    rec.streak = 0;
  }
  const days = INTERVALS[rec.streak];
  rec.nextReview = Date.now() + days * 86400000;
  await dbPut('items', rec);
  return rec;
}

async function getAllItemRecords() {
  return await dbGetAll('items');
}

// ── Shuffle: no two consecutive identical items ───────────────
function shuffleNoConsecutive(arr) {
  // Random shuffle first
  const a = [...arr].sort(() => Math.random() - 0.5);
  // Fix any consecutive duplicates by swapping forward
  for (let i = 1; i < a.length; i++) {
    if (a[i].id === a[i - 1].id) {
      for (let j = i + 1; j < a.length; j++) {
        if (a[j].id !== a[i - 1].id) {
          [a[i], a[j]] = [a[j], a[i]];
          break;
        }
      }
    }
  }
  return a;
}

// ── Last-session chunk tracking ───────────────────────────────
async function getLastSessionChunkIds() {
  const rec = await dbGet('user', 'lastChunks');
  return rec ? rec.ids : [];
}

async function saveLastSessionChunkIds(ids) {
  await dbPut('user', { key: 'lastChunks', ids });
}

// ── SRS: 10 unique chunks × 3 reps = 30 questions ────────────
async function selectQuestions(allItems) {
  const UNIQUE = 10;
  const REPS   = 3;

  const now = Date.now();
  const records = await getAllItemRecords();
  const recMap  = {};
  records.forEach(r => recMap[r.id] = r);

  // Exclude chunks used in the previous session
  const lastIds    = new Set(await getLastSessionChunkIds());
  // Exclude items the user marked as "不要" (excluded)
  const excludedIds = new Set(records.filter(r => r.excluded).map(r => r.id));
  const allChunks  = allItems.filter(i => i.type === 'chunk' && !excludedIds.has(i.id));
  const freshChunks = allChunks.filter(i => !lastIds.has(i.id));

  // Fall back to all chunks if not enough fresh ones
  const pool = freshChunks.length >= UNIQUE ? freshChunks : allChunks;

  // SRS scoring: lower score = higher priority
  const scored = pool.map(item => {
    const rec = recMap[item.id];
    if (!rec || rec.lastSeen === null) return { item, score: Math.random() * 0.5 };
    const overdue  = Math.max(0, now - rec.nextReview);
    const accuracy = rec.correct / (rec.correct + rec.incorrect);
    return { item, score: accuracy - overdue / 86400000 * 0.1 + Math.random() * 0.2 };
  });
  scored.sort((a, b) => a.score - b.score);
  const picked = scored.slice(0, UNIQUE).map(s => s.item);

  // Triple each chunk then shuffle (no consecutive duplicates)
  const tripled = [];
  for (let r = 0; r < REPS; r++) tripled.push(...picked);
  return shuffleNoConsecutive(tripled);
}

// ── Weak items (worst accuracy, seen at least twice) ────────
async function getWeakItems(limit = 50) {
  const records = await getAllItemRecords();
  const allItems = window.ITEMS;
  const itemMap = {};
  allItems.forEach(i => itemMap[i.id] = i);

  const withAccuracy = records
    .filter(r => !r.excluded && (r.correct + r.incorrect) >= 2)
    .map(r => ({
      ...r,
      item: itemMap[r.id],
      accuracy: r.correct / (r.correct + r.incorrect)
    }))
    .filter(r => r.item)
    .sort((a, b) => a.accuracy - b.accuracy);

  return withAccuracy.slice(0, limit);
}

// ── Mastery levels (0-5) ────────────────────────────────────
async function getMasteryMap() {
  const records = await getAllItemRecords();
  const map = {};
  records.forEach(r => {
    if (r.excluded) return; // 除外された単語はマップから除く
    const total = r.correct + r.incorrect;
    if (total === 0) { map[r.id] = 0; return; }
    const acc = r.correct / total;
    if (acc >= 0.95 && r.streak >= 5) map[r.id] = 5;
    else if (acc >= 0.85 && r.streak >= 3) map[r.id] = 4;
    else if (acc >= 0.7) map[r.id] = 3;
    else if (acc >= 0.5) map[r.id] = 2;
    else map[r.id] = 1;
  });
  return map;
}

// ── User state (XP, level, streak, badges) ──────────────────
const DEFAULT_USER = {
  key: 'state',
  xp: 0,
  level: 1,
  streak: 0,
  lastPlayedDate: null,
  badges: [],
  totalSessions: 0,
  totalCorrect: 0,
};

async function getUserState() {
  const s = await dbGet('user', 'state');
  return s || { ...DEFAULT_USER };
}

async function saveUserState(state) {
  await dbPut('user', { ...state, key: 'state' });
}

// XP thresholds per level
function xpForLevel(lvl) { return lvl * lvl * 200; }
function levelFromXP(xp) {
  let lvl = 1;
  while (xp >= xpForLevel(lvl + 1)) lvl++;
  return lvl;
}

// ── Bookmarks ────────────────────────────────────────────────
async function isBookmarked(itemId) {
  const rec = await getItemRecord(itemId);
  return rec?.bookmarked || false;
}

async function toggleBookmark(itemId) {
  let rec = await getItemRecord(itemId);
  if (!rec) rec = { id: itemId, correct: 0, incorrect: 0, streak: 0, nextReview: Date.now(), lastSeen: null };
  rec.bookmarked = !rec.bookmarked;
  await dbPut('items', rec);
  return rec.bookmarked;
}

async function getBookmarkedItems() {
  const records = await getAllItemRecords();
  return records.filter(r => r.bookmarked);
}

async function selectBookmarkQuestions(allItems) {
  const bookmarked = await getBookmarkedItems();
  if (!bookmarked.length) return [];

  // 除外された単語は復習にも出さない
  const excludedIds = new Set(bookmarked.filter(r => r.excluded).map(r => r.id));
  const bookmarkIds = new Set(bookmarked.filter(r => !r.excluded).map(r => r.id));
  const pool = allItems.filter(i => bookmarkIds.has(i.id) && !excludedIds.has(i.id));

  const now = Date.now();
  const records = await getAllItemRecords();
  const recMap = {};
  records.forEach(r => recMap[r.id] = r);

  const scored = pool.map(item => {
    const rec = recMap[item.id];
    if (!rec || rec.lastSeen === null) return { item, score: Math.random() * 0.5 };
    const overdue  = Math.max(0, now - rec.nextReview);
    const accuracy = rec.correct / (rec.correct + rec.incorrect);
    const score    = accuracy - overdue / 86400000 * 0.1 + Math.random() * 0.2;
    return { item, score };
  });

  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, 30)
    .map(s => s.item)
    .sort(() => Math.random() - 0.5);
}

// ── Excluded items (使わない単語) ─────────────────────────────
async function isExcluded(itemId) {
  const rec = await getItemRecord(itemId);
  return rec?.excluded || false;
}

async function setExcluded(itemId, value) {
  let rec = await getItemRecord(itemId);
  if (!rec) rec = { id: itemId, correct: 0, incorrect: 0, streak: 0, nextReview: Date.now(), lastSeen: null };
  rec.excluded = !!value;
  await dbPut('items', rec);
  return rec.excluded;
}

async function toggleExclude(itemId) {
  const current = await isExcluded(itemId);
  return await setExcluded(itemId, !current);
}

async function getExcludedItems() {
  const records = await getAllItemRecords();
  return records.filter(r => r.excluded);
}

async function getExcludedIds() {
  const records = await getAllItemRecords();
  return new Set(records.filter(r => r.excluded).map(r => r.id));
}

// ── Session save ─────────────────────────────────────────────
async function saveSession(score, total, xpGained) {
  const store = tx('sessions', 'readwrite');
  store.add({ date: Date.now(), score, total, xpGained });
}

// ── Update user after session ────────────────────────────────
const BADGE_DEFS = [
  { id:'first_session',  name:'初セッション',   icon:'🎉', desc:'初めてテストを完了した',        check: u => u.totalSessions >= 1 },
  { id:'streak3',        name:'3日連続',        icon:'🔥', desc:'3日連続でプレイした',           check: u => u.streak >= 3 },
  { id:'streak7',        name:'1週間連続',      icon:'🌟', desc:'7日連続でプレイした',           check: u => u.streak >= 7 },
  { id:'streak30',       name:'30日連続',       icon:'💎', desc:'30日連続でプレイした',          check: u => u.streak >= 30 },
  { id:'correct100',     name:'100問正解',      icon:'💯', desc:'合計100問正解した',             check: u => u.totalCorrect >= 100 },
  { id:'correct500',     name:'500問正解',      icon:'🏅', desc:'合計500問正解した',             check: u => u.totalCorrect >= 500 },
  { id:'correct1000',    name:'1000問正解',     icon:'🥇', desc:'合計1000問正解した',            check: u => u.totalCorrect >= 1000 },
  { id:'perfect',        name:'パーフェクト',   icon:'⭐', desc:'30問全問正解した',              check: (u, sess) => sess && sess.score === sess.total },
  { id:'level5',         name:'レベル5',        icon:'🚀', desc:'レベル5に達した',               check: u => u.level >= 5 },
  { id:'level10',        name:'レベル10',       icon:'👑', desc:'レベル10に達した',              check: u => u.level >= 10 },
  { id:'sessions10',     name:'10セッション',   icon:'🎯', desc:'10回テストを完了した',          check: u => u.totalSessions >= 10 },
  { id:'sessions50',     name:'50セッション',   icon:'🏆', desc:'50回テストを完了した',          check: u => u.totalSessions >= 50 },
];

async function afterSession(sessionScore, sessionTotal) {
  const state = await getUserState();
  const today = new Date().toDateString();
  const xpGained = sessionScore * 10 + Math.floor(sessionScore / sessionTotal * 50);

  // Streak
  if (state.lastPlayedDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    state.streak = (state.lastPlayedDate === yesterday) ? state.streak + 1 : 1;
    state.lastPlayedDate = today;
  }

  state.xp += xpGained;
  state.level = levelFromXP(state.xp);
  state.totalSessions++;
  state.totalCorrect += sessionScore;

  // Check badges
  const sess = { score: sessionScore, total: sessionTotal };
  const newBadges = [];
  for (const b of BADGE_DEFS) {
    if (!state.badges.includes(b.id) && b.check(state, sess)) {
      state.badges.push(b.id);
      newBadges.push(b);
    }
  }

  await saveUserState(state);
  await saveSession(sessionScore, sessionTotal, xpGained);
  return { state, xpGained, newBadges };
}

// ── Init: seed all items if first run ───────────────────────
async function initDB() {
  await openDB();
  // No need to pre-seed; records are created lazily on first answer
}

// ── Export / Import progress (for cross-device transfer) ────
async function exportData() {
  const state      = await getUserState();
  const records    = await getAllItemRecords();
  const lastChunks = await getLastSessionChunkIds();
  const payload = {
    version:    1,
    exportedAt: new Date().toISOString(),
    state,
    records,
    lastChunks,
  };
  return JSON.stringify(payload, null, 2);
}

async function importData(jsonText) {
  const data = JSON.parse(jsonText);
  if (!data.version || !data.records || !data.state) {
    throw new Error('無効なデータ形式です');
  }
  for (const rec of data.records) await dbPut('items', rec);
  await saveUserState(data.state);
  if (Array.isArray(data.lastChunks)) await saveLastSessionChunkIds(data.lastChunks);
}

// Exports to window
window.DB = {
  initDB,
  ensureItemRecord,
  recordAnswer,
  getAllItemRecords,
  selectQuestions,
  getWeakItems,
  getMasteryMap,
  getUserState,
  saveUserState,
  afterSession,
  saveLastSessionChunkIds,
  isBookmarked,
  toggleBookmark,
  getBookmarkedItems,
  selectBookmarkQuestions,
  isExcluded,
  setExcluded,
  toggleExclude,
  getExcludedItems,
  getExcludedIds,
  BADGE_DEFS,
  xpForLevel,
  levelFromXP,
  exportData,
  importData,
};
