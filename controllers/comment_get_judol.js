const LoadData = require('../utils/LoadData');
const fs = require('fs');
const express = require('express');

function getJudolComment(text) {
    const normalizedText = text.normalize("NFKD");
    if (text !== normalizedText) { 
        return true;
    }

    const blockedWords = JSON.parse(fs.readFileSync("./config/blockedword.json"));
    const lowerText = text.toLowerCase();

    if (blockedWords.some(word => lowerText.includes(word.toLowerCase()))) {
        return true;
    }

    const words = text.split(/\s+/);
    for (const word of words) {
        const capitalCount = [...word].filter(c => c >= 'A' && c <= 'Z').length;

        // Cek: kapital antara 2-3 → spam
        if (capitalCount > 1 && capitalCount <= 3) {
            return true;
        }

        // Cek: campuran kapital & huruf kecil tidak wajar → spam
        const isAllCaps = word === word.toUpperCase();
        const isAllLower = word === word.toLowerCase();
        const isCapitalized = word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase();

        if (!isAllCaps && !isAllLower && !isCapitalized) {
            return true; // contoh: "ARGaA", "jUDoL", "gRAtiS"
        }
    }

    return false;
}


const test = getJudolComment("ARGaA");
console.log(test);