/**
 * controllers/comment_get_judol.js
 * ------------------------------------------------------------------
 * Manual spam detector + Gemini AI spam detector (batch 100, anti-mismatch).
 * Fokus sesuai instruksi pimpinan:
 *  - Manual function tidak diutak-atik secara logika (hanya guard ringan).
 *  - AI memproses komentar 100 demi 100 (default; bisa override env).
 *  - Hasil batch digabung → return array akhir panjang = jumlah komentar.
 *  - Prompt keras, retry error & retry mismatch, salvage parsing.
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

/* ------------------------------------------------------------------ */
/* Ensure fetch (Node <18)                                            */
/* ------------------------------------------------------------------ */
if (typeof fetch === 'undefined') {
  global.fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
}

/* ------------------------------------------------------------------ */
/* Gemini Setup                                                       */
/* ------------------------------------------------------------------ */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY tidak ditemukan di .env (AI akan fallback 0).');
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || 'dummy');
const MODEL_NAME = 'gemini-2.5-flash';

/* ------------------------------------------------------------------ */
/* Configurable via .env                                              */
/* ------------------------------------------------------------------ */
const AI_BATCH_SIZE          = Number(process.env.AI_BATCH_SIZE || 100); // pimpinan minta 100
const AI_TIMEOUT_MS          = Number(process.env.AI_TIMEOUT_MS || 60000); // 60s
const AI_MAX_RETRIES_ERROR   = Number(process.env.AI_MAX_RETRIES_ERROR || 2); // retry jika error fetch / timeout
const AI_MAX_RETRIES_MISMATCH= Number(process.env.AI_MAX_RETRIES_MISMATCH || 1); // retry jika mismatch panjang
const AI_MAX_COMMENT_CHARS   = Number(process.env.AI_MAX_COMMENT_CHARS || 160);

/* ------------------------------------------------------------------ */
/* Blocked Words (untuk manual)                                       */
/* ------------------------------------------------------------------ */
const blockedWordsPath = path.join(__dirname, '../config/blockedword.json');
let blockedWords = [];
try {
  blockedWords = JSON.parse(fs.readFileSync(blockedWordsPath, 'utf8'));
} catch (error) {
  console.error(`⚠ Tidak bisa baca blockedword.json: ${error.message}`);
  blockedWords = [];
}

/* ================================================================== */
/* Manual Detection (tetap, sederhana)                                */
/* ================================================================== */
function getJudolComment(text) {
  if (!text) return false;

  const normalizedText = text.normalize('NFKD');
  if (text !== normalizedText || /[\u0300-\u036F]/.test(text)) return true; // obfuscation

  const cleanText = text.replace(/<[^>]+>/g, ' ');

  // Bypass share link YouTube
  if (/youtube\.com|youtu\.be/i.test(cleanText)) return false;

  const words = cleanText.split(/\s+/);
  const timestampRegex = /^\d{1,2}:\d{2}(:\d{2})?$/;
  for (const w of words) {
    if (!w) continue;
    if (timestampRegex.test(w)) continue;
    const caps = [...w].filter((c) => c >= 'A' && c <= 'Z').length;
    if (caps > 1) return true;
    const allCaps = w === w.toUpperCase();
    const allLower = w === w.toLowerCase();
    const capWord = /^[A-Z][a-z]+$/.test(w);
    if (!allCaps && !allLower && !capWord && caps !== 1) return true;
    if (/[\u0000-\u001F\u007F-\u009F]/.test(w)) return true;
  }

  const lowerText = cleanText.toLowerCase();
  if (blockedWords.some((word) => lowerText.includes(String(word).toLowerCase()))) return true;

  return false;
}

/* ================================================================== */
/* AI Detection (batch 100, anti-mismatch)                            */
/* ================================================================== */
async function getJudolCommentAi(comments) {
  console.log('getJudolCommentAi called with', comments.length, 'comments');
  console.log(comments);
  if (!Array.isArray(comments) || comments.length === 0) return [];
  if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY kosong. Fallback semua 0.');
    return comments.map(() => 0);
  }

  const out = [];

  for (let start = 0; start < comments.length; start += AI_BATCH_SIZE) {
    const batch = comments.slice(start, start + AI_BATCH_SIZE);
    const labels = await classifyBatchStrict(batch); // anti mismatch
    out.push(...labels);
  }

  // sinkron panjang global
  while (out.length < comments.length) out.push(0);
  if (out.length > comments.length) out.length = comments.length;
  console.log(out);
  return out;
}

/* ------------------------------------------------------------------ */
/* Klasifikasi 1 batch (strict: retry error, retry mismatch)          */
/* ------------------------------------------------------------------ */
async function classifyBatchStrict(batch) {
  const wanted = batch.length;

  // Pertama: prompt utama
  let { ok, labels, raw } = await callBatchAndParse(batch, wanted, buildPromptPrimary);

  // Jika error (fetch/timeout), retry error
  for (let attempt = 1; !ok && attempt <= AI_MAX_RETRIES_ERROR; attempt++) {
    await delay(backoffDelay(attempt));
    ({ ok, labels, raw } = await callBatchAndParse(batch, wanted, buildPromptPrimary));
  }

  // Kalau masih gagal total → fallback 0
  if (!ok && !labels.length) {
    debugWrite('ai-batch-total-fail', { wanted, rawLen: raw?.length, raw });
    return Array(wanted).fill(0);
  }

  // Jika parse sukses tapi panjang mismatch → retry mismatch dgn prompt lebih ketat
  if (labels.length !== wanted) {
    debugWrite('ai-batch-mismatch-1', { got: labels.length, wanted });

    let mismatchLabels = labels;
    let mismatchOk = false;

    for (let attempt = 1; attempt <= AI_MAX_RETRIES_MISMATCH; attempt++) {
      await delay(400); // kecil saja
      const retryRes = await callBatchAndParse(batch, wanted, buildPromptMismatch);
      mismatchOk = retryRes.ok;
      mismatchLabels = retryRes.labels;
      if (mismatchLabels.length === wanted) break;
    }

    labels = mismatchLabels;
  }

  // Pad/potong akhir
  if (labels.length !== wanted) {
    console.warn(`⚠ Panjang hasil AI tidak sesuai (${labels.length} vs ${wanted}). Pad/potong.`);
    while (labels.length < wanted) labels.push(0);
    if (labels.length > wanted) labels.length = wanted;
  }

  return labels;
}

/* ------------------------------------------------------------------ */
/* Panggil Gemini dgn prompt builder & parse                          */
/* ------------------------------------------------------------------ */
async function callBatchAndParse(batch, wanted, promptBuilder) {
  const prompt = promptBuilder(batch, wanted);
  let raw = '';
  try {
    raw = await callGeminiWithTimeout(prompt, AI_TIMEOUT_MS);
  } catch (err) {
    console.error(`⚠ Gemini batch error (${wanted}):`, err.message);
    debugWrite('ai-batch-error', { wanted, error: err.message, prompt });
    return { ok: false, labels: [], raw: '' };
  }

  const labels = parseAiLabels(raw, wanted);
  const ok = labels.length === wanted;
  if (!ok) {
    debugWrite('ai-batch-parse-mismatch', { wanted, got: labels.length, rawSnippet: raw.slice(0, 400) });
  }
  return { ok, labels, raw };
}

/* ------------------------------------------------------------------ */
/* Prompt utama (lebih deskriptif)                                    */
/* ------------------------------------------------------------------ */
function buildPromptPrimary(batch, wanted) {
  return `
Anda adalah filter pendeteksi komentar spam YouTube terkait:
- judi online (slot, kasino, wd/gacor, maxwin)
- pinjaman ilegal
- promosi agresif
- link mencurigakan / scam

KELUARKAN HANYA array JSON angka **tanpa teks lain**.
0 = aman, 1 = spam.
JUMLAH ELEMEN HARUS = ${wanted}.
Jika ragu, isi 0.
Contoh: [0,1,0]

Komentar:
${batch.map((c, i) => `${i + 1}. ${sanitizeComment(c, AI_MAX_COMMENT_CHARS)}`).join('\n')}
`.trim();
}

/* ------------------------------------------------------------------ */
/* Prompt retry mismatch (lebih pendek & keras)                        */
/* ------------------------------------------------------------------ */
function buildPromptMismatch(batch, wanted) {
  return `
Array JSON angka saja.
0 = aman
1 = spam
Harus ${wanted} elemen. Tanpa teks.
[${'0,'.repeat(wanted-1)}0] ← gunakan format ini.

Komentar:
${batch.map((c, i) => `${i + 1}. ${sanitizeComment(c, AI_MAX_COMMENT_CHARS)}`).join('\n')}
`.trim();
}

/* ------------------------------------------------------------------ */
/* Panggil Gemini + timeout                                            */
/* ------------------------------------------------------------------ */
async function callGeminiWithTimeout(prompt, timeoutMs) {
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const sdkPromise = (async () => {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      // memberi hint agar JSON
      generationConfig: { responseMimeType: 'application/json' }
    });
    return result.response.text();
  })();

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Gemini timeout >${timeoutMs}ms`)), timeoutMs)
  );

  return Promise.race([sdkPromise, timeoutPromise]);
}

/* ------------------------------------------------------------------ */
/* Parsing hasil AI                                                    */
/* ------------------------------------------------------------------ */
function parseAiLabels(raw, expectedLen) {
  if (typeof raw !== 'string') return [];

  // 1) JSON parse langsung (mungkin model hanya kirim "0,1,0"?)
  const direct = safeJson(raw);
  if (Array.isArray(direct)) {
    return direct.map((v) => (Number(v) === 1 ? 1 : 0));
  } else if (direct && Array.isArray(direct.labels)) {
    return direct.labels.map((v) => (Number(v) === 1 ? 1 : 0));
  }

  // 2) Cari blok array
  const m = raw.match(/\[[^\]]*\]/);
  if (m) {
    const arr = safeJson(m[0]);
    if (Array.isArray(arr)) {
      return arr.map((v) => (Number(v) === 1 ? 1 : 0));
    }
  }

  // 3) Salvage angka 0/1
  const salvage = raw.match(/[01]/g);
  if (salvage) {
    return salvage.slice(0, expectedLen).map((n) => (n === '1' ? 1 : 0));
  }

  return [];
}

/* ------------------------------------------------------------------ */
/* Utils                                                               */
/* ------------------------------------------------------------------ */
function sanitizeComment(text, maxLen = 160) {
  return String(text || '').replace(/\s+/g, ' ').slice(0, maxLen);
}

function safeJson(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function backoffDelay(attempt) {
  const base = 1500 * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/* Debug log (aktifkan dengan DEBUG_JUDOL_LOG=1) */
function debugWrite(prefix, data) {
  if (process.env.DEBUG_JUDOL_LOG !== '1') return;
  try {
    const dir = path.join(__dirname, '../logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${prefix}-${Date.now()}.json`);
    fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  } catch (_) {}
}

module.exports = { getJudolComment, getJudolCommentAi };
