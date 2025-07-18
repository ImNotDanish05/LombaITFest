const fs = require('fs');
const path = require('path');
require('dotenv').config();

if (typeof fetch === 'undefined') {
  global.fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
}

const { GoogleGenerativeAI } = require('@google/generative-ai');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) console.error('❌ GEMINI_API_KEY tidak ditemukan di .env');

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const MODEL_NAME = 'gemini-2.5-flash';

// Load blocked words (manual filter)
const blockedWordsPath = path.join(__dirname, '../config/blockedword.json');
let blockedWords = [];
try { blockedWords = JSON.parse(fs.readFileSync(blockedWordsPath, 'utf8')); }
catch (e) { console.error('⚠ blockedword.json:', e.message); blockedWords = []; }

/* ========================================================== */
/* =============== Manual Detection Function =============== */
/* ========================================================== */
function getJudolComment(text) {
  if (!text) return false;
  const normalizedText = text.normalize('NFKD');
  if (text !== normalizedText || /[\u0300-\u036F]/.test(text)) return true;

  const cleanText = text.replace(/<[^>]+>/g, ' ');
  if (/youtube\.com|youtu\.be/i.test(cleanText)) return false;

  const words = cleanText.split(/\s+/);
  const timestampRegex = /^\d{1,2}:\d{2}(:\d{2})?$/;
  for (const w of words) {
    if (!w) continue;
    if (timestampRegex.test(w)) continue;
    const caps = [...w].filter(c => c >= 'A' && c <= 'Z').length;
    if (caps > 1) return true;
    const allCaps = w === w.toUpperCase();
    const allLower = w === w.toLowerCase();
    const capWord = /^[A-Z][a-z]+$/.test(w);
    if (!allCaps && !allLower && !capWord && caps !== 1) return true;
    if (/[\u0000-\u001F\u007F-\u009F]/.test(w)) return true;
  }

  const lower = cleanText.toLowerCase();
  if (blockedWords.some(bw => lower.includes(String(bw).toLowerCase()))) return true;

  return false;
}

/* ========================================================== */
/* ================== AI Detection (Gemini) ================= */
/* ========================================================== */
async function getJudolCommentAi(comments) {
  if (!Array.isArray(comments) || comments.length === 0) return [];
  if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY tidak tersedia. Fallback semua 0.');
    return comments.map(() => 0);
  }

  const BATCH_SIZE = 100;
  const out = [];
  for (let i = 0; i < comments.length; i += BATCH_SIZE) {
    const batch = comments.slice(i, i + BATCH_SIZE);
    const labels = await classifyBatchRecursive(batch, 20000);
    out.push(...labels);
  }

  while (out.length < comments.length) out.push(0);
  if (out.length > comments.length) out.length = comments.length;
  return out;
}

async function classifyBatchRecursive(batchComments, timeoutMs) {
  if (batchComments.length === 1) {
    const single = await classifySingle(batchComments[0], timeoutMs / 2);
    return [single];
  }
  try {
    const labels = await classifyBatchOnce(batchComments, timeoutMs);
    return labels;
  } catch (err) {
    console.warn(`⚠ Batch gagal (${batchComments.length}): ${err.message}. Split...`);
    const mid = Math.floor(batchComments.length / 2);
    const left = await classifyBatchRecursive(batchComments.slice(0, mid), timeoutMs);
    const right = await classifyBatchRecursive(batchComments.slice(mid), timeoutMs);
    return [...left, ...right];
  }
}

async function classifyBatchOnce(batchComments, timeoutMs) {
  const prompt = buildBatchPrompt(batchComments);
  const raw = await callGeminiWithTimeout(prompt, timeoutMs);
  let labels = parseAiLabels(raw, batchComments.length);

  if (labels.length !== batchComments.length) {
    console.warn(`⚠ Panjang hasil AI tidak sesuai (${labels.length} vs ${batchComments.length}). Pad/potong.`);
    while (labels.length < batchComments.length) labels.push(0);
    if (labels.length > batchComments.length) labels.length = batchComments.length;
  }
  return labels;
}

async function classifySingle(commentText, timeoutMs = 8000) {
  const prompt = buildSinglePrompt(commentText);
  try {
    const raw = await callGeminiWithTimeout(prompt, timeoutMs);
    const m = raw.match(/[01]/);
    return m ? Number(m[0]) : 0;
  } catch {
    return 0;
  }
}

function buildBatchPrompt(batch) {
  return `
Anda adalah filter pendeteksi komentar SPAM judi online/pinjaman ilegal.
0 = bukan spam
1 = spam
Jawab hanya array JSON: [0,1,0,...] dengan ${batch.length} elemen.

Komentar:
${batch.map((c, i) => `${i + 1}. ${sanitizeComment(c, 150)}`).join('\n')}
`.trim();
}

function buildSinglePrompt(comment) {
  return `Balas 1 jika SPAM judi/pinjaman ilegal, selain itu 0. Komentar: ${sanitizeComment(comment, 150)}`;
}

async function callGeminiWithTimeout(prompt, timeoutMs) {
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });
  const sdkPromise = (async () => {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    return result.response.text();
  })();
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Gemini timeout >${timeoutMs}ms`)), timeoutMs)
  );
  return Promise.race([sdkPromise, timeoutPromise]);
}

function parseAiLabels(raw, expectedLen) {
  if (!raw) return [];
  const arrMatch = raw.match(/\[[^\]]*\]/);
  if (arrMatch) {
    try {
      const arr = JSON.parse(arrMatch[0]);
      return arr.map(v => (Number(v) === 1 ? 1 : 0));
    } catch {}
  }
  const salvage = raw.match(/[01]/g);
  if (salvage) {
    return salvage.slice(0, expectedLen).map(n => (n === '1' ? 1 : 0));
  }
  return [];
}

function sanitizeComment(text, maxLen = 200) {
  return String(text || '').replace(/\s+/g, ' ').slice(0, maxLen);
}

module.exports = { getJudolComment, getJudolCommentAi };
