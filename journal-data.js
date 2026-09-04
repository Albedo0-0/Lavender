// journal-data.js — Journal data layer. No UI here. Depends on: State, Storage, DateHub, PlannerData.
// State shape: State.get().journalEntries = { dateStr: {
//   morningQuote, weather, mood, hoursStudied, diaryText, photos: [photoId,...],
//   manifestationText, challenge: { studyTopicId, physicalChallenge, startedAt, completed, completedAt }
// }}
// State.get().journalPasswordHash / journalLocked = global journal lock (not per-date).
// hoursStudied is mirrored into DateHub.update() so Calendar's Streak keeps working unchanged.

const JournalData = (function () {
  const CHALLENGE_MS = 60 * 60 * 1000;
  const PHYSICAL_CHALLENGES = [
    '10 minute walk outside',
    '20 jumping jacks',
    '5 minute stretch break',
    '15 squats',
    '2 minute plank (broken into sets if needed)',
    'Tidy your desk for 10 minutes',
    '10 minute walk up and down stairs',
    'Drink a full bottle of water and do a lap around the house'
  ];

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function toDateStr(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function todayStr() {
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function generateId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function blankEntry() {
    return {
      morningQuote: '',
      weather: null,
      mood: null,
      hoursStudied: 0,
      questionsSolved: 0,
      diaryText: '',
      photos: [],
      manifestationText: '',
      challenge: {
        studyTopicId: null,
        physicalChallenge: null,
        startedAt: null,
        completed: null,
        completedAt: null
      }
    };
  }

  // ---------- Entries ----------

  function getAllEntries() {
    return State.get().journalEntries || {};
  }

  function getEntry(dateStr) {
    const all = getAllEntries();
    return all[dateStr] ? Object.assign(blankEntry(), all[dateStr]) : blankEntry();
  }

  function updateEntry(dateStr, partial) {
    const all = Object.assign({}, getAllEntries());
    const existing = getEntry(dateStr);
    all[dateStr] = Object.assign({}, existing, partial);
    State.set({ journalEntries: all });
    return all[dateStr];
  }

  function setHoursStudied(dateStr, hours) {
    const n = Math.max(0, Number(hours) || 0);
    updateEntry(dateStr, { hoursStudied: n });
    // Journal is the source of truth; mirror into DateHub so Streak/Calendar read it unchanged.
    DateHub.update(dateStr, { studyHours: n });
  }

  function isImportant(dateStr) {
    return !!DateHub.get(dateStr).important;
  }

  function hasContent(dateStr) {
    const e = getEntry(dateStr);
    return !!(e.diaryText || e.manifestationText || e.mood || e.weather || e.hoursStudied || e.photos.length);
  }

  // ---------- Password / Lock ----------
  // Password itself is never stored — only a SHA-256 hash, derived locally.

  async function hashPassword(plain) {
    const enc = new TextEncoder().encode(plain);
    const digest = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  function hasPassword() {
    return !!State.get().journalPasswordHash;
  }

  async function setPassword(newPass) {
    const hash = await hashPassword(newPass);
    State.set({ journalPasswordHash: hash });
  }

  async function changePassword(oldPass, newPass) {
    const ok = await verifyPassword(oldPass);
    if (!ok) return false;
    await setPassword(newPass);
    return true;
  }

  async function verifyPassword(plain) {
    const hash = await hashPassword(plain);
    return hash === State.get().journalPasswordHash;
  }

  function isLocked() {
    return !!State.get().journalLocked;
  }

  function lock() {
    State.set({ journalLocked: true });
  }

  async function unlock(plain) {
    const ok = await verifyPassword(plain);
    if (ok) State.set({ journalLocked: false });
    return ok;
  }

  // ---------- Photos (stored in IndexedDB via Storage; only ids live in journalEntries) ----------

  function addPhoto(dateStr, file) {
    return Storage.getDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const id = generateId('photo');
        const tx = db.transaction('media', 'readwrite');
        tx.objectStore('media').put({ id: id, dateStr: dateStr, blob: file });
        tx.oncomplete = function () {
          const entry = getEntry(dateStr);
          updateEntry(dateStr, { photos: entry.photos.concat([id]) });
          resolve(id);
        };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function removePhoto(dateStr, photoId) {
    return Storage.getDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction('media', 'readwrite');
        tx.objectStore('media').delete(photoId);
        tx.oncomplete = function () {
          const entry = getEntry(dateStr);
          updateEntry(dateStr, { photos: entry.photos.filter(function (id) { return id !== photoId; }) });
          resolve();
        };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function getPhotoURL(photoId) {
    return Storage.getDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction('media', 'readonly');
        const req = tx.objectStore('media').get(photoId);
        req.onsuccess = function () {
          resolve(req.result ? URL.createObjectURL(req.result.blob) : null);
        };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  // ---------- Daily Challenge ----------

  function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function generateChallenge(dateStr) {
    const topicMap = PlannerData.getTopicsBySubject();
    const allTopics = []
      .concat(topicMap.Biology || [])
      .concat(topicMap.Chemistry || [])
      .concat(topicMap.Physics || []);

    const topic = allTopics.length ? pickRandom(allTopics) : null;
    const physical = pickRandom(PHYSICAL_CHALLENGES);

    const challenge = {
      studyTopicId: topic ? topic.topicId : null,
      physicalChallenge: physical,
      startedAt: Date.now(),
      completed: null,
      completedAt: null
    };
    updateEntry(dateStr, { challenge: challenge });
    return challenge;
  }

  function getChallengeTopicName(dateStr) {
    const entry = getEntry(dateStr);
    if (!entry.challenge.studyTopicId) return null;
    const topics = State.get().topics || {};
    const t = topics[entry.challenge.studyTopicId];
    return t ? (t.subject + ' \u2014 ' + t.topicName) : null;
  }

  function getChallengeElapsedMs(dateStr) {
    const entry = getEntry(dateStr);
    if (!entry.challenge.startedAt) return null;
    return Date.now() - entry.challenge.startedAt;
  }

  function getChallengeRemainingMs(dateStr) {
    const elapsed = getChallengeElapsedMs(dateStr);
    if (elapsed === null) return null;
    return Math.max(0, CHALLENGE_MS - elapsed);
  }

  function completeChallenge(dateStr, didComplete) {
    const entry = getEntry(dateStr);
    const challenge = Object.assign({}, entry.challenge, {
      completed: !!didComplete,
      completedAt: Date.now()
    });
    updateEntry(dateStr, { challenge: challenge });
    return challenge;
  }

  function isBlueFire(dateStr) {
    return getEntry(dateStr).challenge.completed === true;
  }

  return {
    getEntry: getEntry,
    getAllEntries: getAllEntries,
    updateEntry: updateEntry,
    setHoursStudied: setHoursStudied,
    isImportant: isImportant,
    hasContent: hasContent,

    hasPassword: hasPassword,
    setPassword: setPassword,
    changePassword: changePassword,
    verifyPassword: verifyPassword,
    isLocked: isLocked,
    lock: lock,
    unlock: unlock,

    addPhoto: addPhoto,
    removePhoto: removePhoto,
    getPhotoURL: getPhotoURL,

    CHALLENGE_MS: CHALLENGE_MS,
    generateChallenge: generateChallenge,
    getChallengeTopicName: getChallengeTopicName,
    getChallengeElapsedMs: getChallengeElapsedMs,
    getChallengeRemainingMs: getChallengeRemainingMs,
    completeChallenge: completeChallenge,
    isBlueFire: isBlueFire
  };
})();
