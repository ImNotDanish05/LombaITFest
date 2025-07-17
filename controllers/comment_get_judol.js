const LoadData = require('../utils/LoadData');
const fs = require('fs');
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
// const axios = require('axios'); // Hapus ini jika tidak digunakan lagi untuk API lain
dotenv.config();

// --- Tambahkan ini untuk Gemini API ---
const { GoogleGenerativeAI } = require('@google/generative-ai');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Inisialisasi model Gemini Pro
// Pastikan GEMINI_API_KEY tersedia di file .env Anda
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });
// ------------------------------------

//const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY; // Tetap ada jika Anda masih menggunakannya untuk hal lain

// === Manual Check ===

function getJudolComment(text) {
    if (!text) return false;

    // Normalisasi text
    const normalizedText = text.normalize("NFKD");
    const hasCombiningChar = /[\u0300-\u036F]/.test(text);
    if (text !== normalizedText || hasCombiningChar) {
        return true;
    }

    // Hapus tag HTML
    const cleanText = text.replace(/<[^>]+>/g, ' ');
    // Split kata dari cleanText, bukan text asli
    const words = cleanText.split(/\s+/);

    // Deteksi link YouTube (di cleanText)
    const isYouTubeLink = /youtube\.com|youtu\.be/i.test(cleanText);
    if (isYouTubeLink) {
        console.log("Bypass YouTube link:", text);
        return false;
    }

    const timestampRegex = /^\d{1,2}:\d{2}(:\d{2})?$/;

    // Cek setiap kata
    for (const word of words) {
        if (!word) continue;

        if (timestampRegex.test(word)) continue; // bypass timestamp

        const capitalCount = [...word].filter(c => c >= 'A' && c <= 'Z').length;
        if (capitalCount > 1) return true;

        const isAllCaps = word === word.toUpperCase();
        const isAllLower = word === word.toLowerCase();
        const isCapitalized = /^[A-Z][a-z]+$/.test(word);

        if (!isAllCaps && !isAllLower && !isCapitalized && capitalCount !== 1) return true;

        // Cara lebih aman untuk deteksi karakter aneh
        if (/[\u0000-\u001F\u007F-\u009F]/.test(word)) {
            return true; // ada karakter kontrol → spam
        }
    }

    // Cek blocked words
    const blockedWordsPath = path.join(__dirname, '../config/blockedword.json');
    const blockedWords = JSON.parse(fs.readFileSync(blockedWordsPath));
    const lowerText = cleanText.toLowerCase();
    if (blockedWords.some(word => lowerText.includes(word.toLowerCase()))) return true;

    return false;
}


// === AI Check (Menggunakan Gemini) ===
async function getJudolCommentAi(comments) {
    if (!comments || comments.length === 0) return [];

    const prompt = comments.map((text, i) => `${i + 1}. ${text}`).join('\n');

    // Prompt yang disesuaikan untuk Gemini
    const systemPrompt = `
Anda adalah filter pendeteksi komentar spam di YouTube. Tugas Anda adalah menandai komentar yang mengandung promosi terselubung, judi online (termasuk slot, kasino, poker, dll.), pinjaman ilegal, penipuan, atau sejenisnya. Anda harus sangat ketat dalam deteksi.

Berikan jawaban hanya dalam format array JSON yang berisi angka 1 (jika komentar adalah spam) atau 0 (jika bukan spam), sesuai urutan komentar yang diberikan.
Contoh format output: [0, 1, 0, 1, 0]

Daftar komentar untuk dianalisis:
`;

    try {
        const result = await model.generateContent([
            { text: systemPrompt.trim() + '\n' + prompt }
        ]);
        const response = await result.response;
        const text = response.text(); // Ambil teks respons dari Gemini

        // Hapus backticks atau format lain yang mungkin ditambahkan oleh model
        const cleaned = text.replace(/```json|```/g, '').trim();

        try {
            const parsed = JSON.parse(cleaned);
            // Validasi sederhana: pastikan hasilnya array angka 0 atau 1
            if (Array.isArray(parsed) && parsed.every(item => item === 0 || item === 1)) {
                console.log("✅ AI berhasil parse JSON:", parsed);
                return parsed;
            } else {
                console.error("❌ Respons JSON dari AI tidak valid atau formatnya salah:\n", cleaned);
                return comments.map(() => 0); // fallback: dianggap aman semua
            }
        } catch (jsonErr) {
            console.error("❌ Gagal parse JSON dari AI:\n", cleaned, "Error:", jsonErr.message);
            return comments.map(() => 0); // fallback: dianggap aman semua
        }

    } catch (error) {
        console.error("❌ Error memanggil Gemini API:", error.message);
        // Terkadang error bisa jadi objek, pastikan untuk log lebih detail
        if (error.response && error.response.data) {
            console.error("Detail Error:", error.response.data);
        }
        return comments.map(() => 0); // fallback: dianggap aman semua
    }
}


// Eksekusi contoh hanya jika file ini dijalankan langsung
if (require.main === module) {
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

        console.log(`\n🧠 Mengecek ${notDetectedManually.length} komentar lewat AI (Gemini)...`);
        const hasilAi = await getJudolCommentAi(notDetectedManually);

        if (hasilAi.length !== notDetectedManually.length) {
            console.warn("⚠️ Perhatian: Jumlah respons AI tidak sesuai dengan jumlah komentar yang dikirim.");
            // Mungkin perlu penanganan error lebih lanjut di sini, atau coba lagi
        }

        hasilAi.forEach((hasil, i) => {
            const comment = notDetectedManually[i];
            const status = hasil ? 1 : 0;
            console.log(`🔍 AI (Gemini) check for: "${comment}" → ${status}`);
        });
    })();
}

module.exports = { getJudolComment, getJudolCommentAi };