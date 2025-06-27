const LoadData = require('../utils/LoadData');
const fs = require('fs');
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const axios = require('axios');
dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
console.log("KEY:", OPENROUTER_API_KEY);

// === Manual Check ===
function getJudolComment(text) {
    if (!text) return false;

    const normalizedText = text.normalize("NFKD");
    const hasCombiningChar = /[\u0300-\u036F]/.test(text);
    if (text !== normalizedText || hasCombiningChar) return true;

    const blockedWordsPath = path.join(__dirname, '../config/blockedword.json');
    const blockedWords = JSON.parse(fs.readFileSync(blockedWordsPath));
    const lowerText = text.toLowerCase();
    if (blockedWords.some(word => lowerText.includes(word.toLowerCase()))) return true;

    const words = text.split(/\s+/);
    for (const word of words) {
        if (!word) continue;

        const capitalCount = [...word].filter(c => c >= 'A' && c <= 'Z').length;
        if (capitalCount > 1 && capitalCount <= 3) return true;

        const isAllCaps = word === word.toUpperCase();
        const isAllLower = word === word.toLowerCase();
        const isCapitalized = /^[A-Z][a-z]+$/.test(word);

        if (!isAllCaps && !isAllLower && !isCapitalized) return true;

        if (/[^a-zA-Z0-9\s.,!?'"()<>:@#\-]/.test(word)) return true;
    }

    return false;
}

// === AI Check ===
async function getJudolCommentAi(comments) {
    if (!comments || comments.length === 0) return [];

    const prompt = comments.map((text, i) => `${i + 1}. ${text}`).join('\n');

    const systemPrompt = `
Kamu adalah filter pendeteksi komentar spam di YouTube. Tugasmu adalah menandai komentar yang mengandung promosi terselubung, judi, slot, pinjaman, atau sejenisnya.

Berikan jawaban dalam format array JSON yang hanya berisi 1 atau 0, sesuai urutan komentar:
Contoh: [0, 1, 0]
`;

    try {
        const response = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                model: "mistralai/mistral-small-3.2-24b-instruct",
                messages: [
                    { role: "system", content: systemPrompt.trim() },
                    { role: "user", content: prompt }
                ],
                temperature: 0.2,
            },
            {
                headers: {
                    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        const raw = response.data.choices[0].message.content.trim();
        const cleaned = raw.replace(/```json|```/g, '').trim();

        try {
            const parsed = JSON.parse(cleaned);
            return parsed;
        } catch (jsonErr) {
            console.error("❌ Gagal parse JSON dari AI:\n", cleaned);
            return comments.map(() => 0); // fallback: dianggap aman semua
        }

    } catch (error) {
        console.error("❌ Error AI:", error.message);
        return comments.map(() => 0);
    }
}




// === Contoh Daftar Komentar ===
const comments = [
    "Keren banget videonya!",
    "A̷P̷N̷S̷L̷O̷T̷ GACOR BANGET!",
    "Main slot di situs xxx gacor",
    "Suka banget sama kontennya",
    "Mantap WD tiap malam bro",
    "Aku main judi online untung cuyyy, ke web judol.com",
    "Gimana cara menang judi slot?",
    "Aku suka main judi, ada yang mau join?",
    "Video kamu keren banget, pengen belajar bareng deh :D",
    "Aku baru menang judi online, seneng banget!",
    "Add roblox gw dong kak",
    "Minecraft add aku dong di essentials"
];

// === Proses Manual → AI
(async () => {
    const notDetectedManually = [];

    for (const comment of comments) {
        const isSpamManual = getJudolComment(comment);
        const status = isSpamManual ? 1 : 0;
        console.log(`🧪 Manual check for: "${comment}" → ${status}`);

        if (!isSpamManual) {
            notDetectedManually.push(comment);
        }
    }

    if (notDetectedManually.length === 0) {
        console.log("✅ Semua komentar berhasil terdeteksi manual sebagai spam.");
        return;
    }

    console.log(`\n🧠 Mengecek ${notDetectedManually.length} komentar lewat AI...\n`);
    const hasilAi = await getJudolCommentAi(notDetectedManually);

    hasilAi.forEach((hasil, i) => {
        const status = hasil ? 1 : 0;
        console.log(`🔍 AI check for: "${notDetectedManually[i]}" → ${status}`);
    });
})();
