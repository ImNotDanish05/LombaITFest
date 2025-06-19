const LoadData = require('./utils/LoadData');
const express = require('express');

function getJudolComment(text) {
    const normalizedText = text.normalize("NFKD");
    if (text !== normalizedText) { 
        return true
    }
    const blockedWords = JSON.parse(fs.readFileSync("blockedword.json"));

    const lowerText = text.toLowerCase();

    return blockedWords.some(word => lowerText.includes(word.toLowerCase()));
}