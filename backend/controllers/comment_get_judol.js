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

        if (/[^a-zA-Z0-9\s]/.test(word)) return true;
    }

    return false;
}

// === AI Check ===
async function getJudolCommentAi(text) {
    if (!text) return false;

    try {
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: "mistralai/mistral-small-3.2-24b-instruct",
                messages: [
                    {
                        role: "system",
                        content: "Kamu adalah sistem pendeteksi komentar spam di YouTube. Jawablah hanya dengan 'true' jika komentar tersebut adalah spam (misalnya promosi judi online, judol, slot, pinjaman, dsb), atau 'false' jika bukan spam."
                    },
                    {
                        role: "user",
                        content: `Komentar: "${text}"`
                    }
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

        const result = response.data.choices[0].message.content.trim().toLowerCase();
        return result === 'true';
    } catch (error) {
        console.error("❌ Error AI:", error.message);
        return false;
    }
}


// === Contoh Daftar Komentar ===
const comments = [
    "Keren banget videonya!",
    "A̷P̷N̷S̷L̷O̷T̷ GACOR BANGET!",
    "Main slot di situs xxx gacor",
    "Suka banget sama kontennya"
];

// === Proses Manual → AI
(async () => {
    const notDetectedManually = [];

    for (const comment of comments) {
        const isSpamManual = getJudolComment(comment);
        console.log(`🧪 Manual check for: "${comment}" → ${isSpamManual ? 'SPAM' : 'AMAN'}`);

        if (!isSpamManual) {
            notDetectedManually.push(comment);
        }
    }

    console.log(`\n🧠 Mengecek ${notDetectedManually.length} komentar lewat AI...\n`);

    for (const comment of notDetectedManually) {
        const isSpamAI = await getJudolCommentAi(comment);
        console.log(`🔍 AI check for: "${comment}" → ${isSpamAI ? 'SPAM' : 'AMAN'}`);
    }
})();
