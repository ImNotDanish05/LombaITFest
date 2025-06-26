const LoadData = require('../utils/LoadData');
const fs = require('fs');
const express = require('express');
const dotenv = require('dotenv');
dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

function getJudolComment(text) {
    if (!text) {
        return false; // Tidak ada teks yang diberikan
    }
    const normalizedText = text.normalize("NFKD");

    // Deteksi jika ada karakter combining (misalnya A̷P̷N̷)
    const hasCombiningChar = /[\u0300-\u036F]/.test(text);
    if (text !== normalizedText || hasCombiningChar) { 
        return true;
    }

    // Cek dari file blockedword.json
    const blockedWords = JSON.parse(fs.readFileSync("./backend/config/blockedword.json"));
    const lowerText = text.toLowerCase();
    if (blockedWords.some(word => lowerText.includes(word.toLowerCase()))) {
        return true;
    }

    // Periksa tiap kata
    const words = text.split(/\s+/);
    for (const word of words) {
        const capitalCount = [...word].filter(c => c >= 'A' && c <= 'Z').length;

        // Cek jika kapital antara 2–3 → spam
        if (capitalCount > 1 && capitalCount <= 3) {
            return true;
        }

        // Cek pola kapital tidak wajar (misal: "jUDoL", "ARgaA")
        const isAllCaps = word === word.toUpperCase();
        const isAllLower = word === word.toLowerCase();
        const isCapitalized = word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase();

        if (!isAllCaps && !isAllLower && !isCapitalized) {
            return true;
        }

        // Cek karakter non-standar (selain alfabet biasa dan angka)
        if (/[^a-zA-Z0-9\s]/.test(word)) {
            return true;
        }
    }

    return false;
}



const test = getJudolComment("");
console.log(test);