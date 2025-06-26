const LoadData = require('../utils/LoadData');
const fs = require('fs');
const express = require('express');

function getJudolComment(text) {
    const normalizedText = text.normalize("NFKD");
    if (text !== normalizedText) { 
        return true
    }
    const blockedWords = JSON.parse(fs.readFileSync("./config/blockedword.json"));

    const lowerText = text.toLowerCase();

    return blockedWords.some(word => lowerText.includes(word.toLowerCase()));
}

const test = getJudolComment("Arga.");
console.log(test);