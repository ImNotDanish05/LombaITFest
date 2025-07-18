const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

let he;
try {
  he = require('he');
} catch {
  // fallback mini decoder
  he = {
    decode: (s) =>
      String(s)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'"),
  };
}

const { getVideoIdFromUrl } = require('../controllers/youtube/index');
const { getJudolComment, getJudolCommentAi } = require('../controllers/comment_get_judol');
const { authSession } = require('../controllers/authSession');
const { loadYoutubeCredentials } = require('../utils/LoadData');
const isProductionHttps = require('../utils/isProductionHttps');

/* --- DEBUG controller load --- */
if (process.env.NODE_ENV !== 'production') {
  console.log('[youtubeComments] controller types:', {
    getJudolComment: typeof getJudolComment,
    getJudolCommentAi: typeof getJudolCommentAi,
  });
}

/* ------------------------------------------------------------------ */
/* Route: /youtube/get-comments */
/* ------------------------------------------------------------------ */
router.post('/get-comments', authSession, async (req, res) => {
  try {
    const useAi = req.body.useAiJudol === '1';
    const youtubeUrl = req.body.youtubeUrl;
    const credentials = loadYoutubeCredentials();

    /* ---------------- Validasi URL → Video ID ---------------- */
    const videoId = getVideoIdFromUrl(youtubeUrl);
    if (!videoId) return res.status(400).send('❌ Link YouTube tidak valid.');

    /* ---------------- OAuth ---------------- */
    const oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      isProductionHttps() ? credentials.redirect_uris[1] : credentials.redirect_uris[0]
    );

    oauth2Client.setCredentials({
      access_token: req.user.access_token,
      refresh_token: req.user.refresh_token,
    });

    // Refresh token jika perlu
    try {
      await oauth2Client.getAccessToken();
    } catch (refreshError) {
      console.warn('⚠ Token kadaluarsa, mencoba refresh...', refreshError?.message);
      const tokens = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(tokens.credentials);
    }

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    /* ---------------- Info Video ---------------- */
    const videoResponse = await youtube.videos.list({
      part: 'snippet',
      id: videoId,
    });
    const videoItem = videoResponse?.data?.items?.[0];
    if (!videoItem) return res.status(404).send('❌ Video tidak ditemukan.');

    // Kita tidak cek kepemilikan channel lagi
    const isOwner = false;

    do {
      const response = await youtube.commentThreads.list({
        part: 'snippet',
        videoId,
        maxResults: 100,
        pageToken: nextPageToken || '',
      });

      const items = response?.data?.items;
      if (!items || !items.length) break;

      const commentsBatch = items.map((item) => ({
        text: item.snippet.topLevelComment.snippet.textDisplay,
        commentId: item.snippet.topLevelComment.id,
        author: item.snippet.topLevelComment.snippet.authorDisplayName,
        publishedAt: item.snippet.topLevelComment.snippet.publishedAt,
        updatedAt: item.snippet.topLevelComment.snippet.updatedAt,
        likeCount: item.snippet.topLevelComment.snippet.likeCount,
      }));

      allComments = allComments.concat(commentsBatch);
      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    /* ---------------- Tidak ada komentar ---------------- */
    if (allComments.length === 0) {
      return res.render('pages/komentar_spam', {
        user: safeUser(req.user),
        comments: [],
        stats: { total: 0, spam: 0, manualSpam: 0, aiSpam: 0, ratio: 0 },
        videoTitle: videoItem.snippet.title,
        videoId,
        useAi,
        showAll,
      });
    }

    /* ---------------- Manual Detection ---------------- */
    const manualResults = allComments.map((c) => {
      try {
        return !!getJudolComment(c.text);
      } catch (e) {
        console.warn('manual detect error:', e);
        return false;
      }
    });

    // Komentar yang aman manual → kandidat AI
    const notDetectedManuallyIdx = [];
    const notDetectedManuallyTexts = [];
    manualResults.forEach((isSpam, i) => {
      if (!isSpam) {
        notDetectedManuallyIdx.push(i);
        notDetectedManuallyTexts.push(allComments[i].text);
      }
    });

    /* ---------------- AI Detection (opsional) ---------------- */
    let aiResults = [];
    if (useAi && notDetectedManuallyTexts.length > 0) {
      try {
        aiResults = await getJudolCommentAi(notDetectedManuallyTexts);
      } catch (err) {
        console.error('AI error (outer):', err.message);
        aiResults = Array(notDetectedManuallyTexts.length).fill(0);
      }

      // panjang sinkron
      if (!Array.isArray(aiResults)) aiResults = [];
      while (aiResults.length < notDetectedManuallyTexts.length) aiResults.push(0);
      if (aiResults.length > notDetectedManuallyTexts.length) aiResults.length = notDetectedManuallyTexts.length;
    }

    /* ---------------- Gabungkan Manual + AI ---------------- */
    const spamResults = Array(allComments.length).fill(0);
    // Manual
    manualResults.forEach((isSpam, i) => {
      if (isSpam) spamResults[i] = 1;
    });
    // AI
    let aiPtr = 0;
    for (const idx of notDetectedManuallyIdx) {
      spamResults[idx] = useAi ? (Number(aiResults[aiPtr++]) === 1 ? 1 : 0) : 0;
    }

    /* ---------------- Bersihkan teks komentar ---------------- */
    const cleanAllComments = allComments.map((c) => ({
      ...c,
      text: sanitizeDisplayText(c.text),
    }));

    /* ---------------- Tambahkan status spam ---------------- */
    const commentsWithSpam = cleanAllComments.map((c, i) => ({
      ...c,
      isSpam: spamResults[i],
      flaggedBy: manualResults[i]
        ? 'manual'
        : (useAi && spamResults[i] ? 'ai' : null),
    }));

    /* ---------------- Filter spam / all ---------------- */
    const displayedComments = showAll ? commentsWithSpam : commentsWithSpam.filter((c) => c.isSpam);

    /* ---------------- Statistik ---------------- */
    const manualSpamCount = manualResults.reduce((n, v) => n + (v ? 1 : 0), 0);
    const spamCount = spamResults.reduce((n, v) => n + (v ? 1 : 0), 0);
    const stats = {
      total: allComments.length,
      spam: spamCount,
      manualSpam: manualSpamCount,
      aiSpam: Math.max(0, spamCount - manualSpamCount),
      ratio: allComments.length > 0 ? ((spamCount / allComments.length) * 100).toFixed(2) : 0,
    };

    /* ---------------- Debug Log ---------------- */
    writeDebugLogSafe(path.join(__dirname, '../logs'), {
      ts: new Date().toISOString(),
      videoId,
      total: allComments.length,
      useAi,
      showAll,
      manualSpam: manualSpamCount,
      aiSpam: stats.aiSpam,
      commentsSpam: commentsWithSpam
        .filter((c) => c.isSpam)
        .map((c) => ({ id: c.commentId, flaggedBy: c.flaggedBy, text: c.text })),
    });

    /* ---------------- Render ---------------- */
    res.render('pages/komentar_spam', {
      user: safeUser(req.user),
      comments: displayedComments,
      stats,
      videoTitle: videoItem.snippet.title,
      videoId,
      useAi,
      showAll,
    });
  } catch (err) {
    console.error('YouTube API error:', err);
    res.status(500).send('❌ Gagal mengambil komentar.');
  }
});

module.exports = router;

/* ------------------------------------------------------------------ */
/* ------------------------- Helper Functions ----------------------- */
/* ------------------------------------------------------------------ */

/** Pastikan user object aman untuk view. */
function safeUser(u = {}) {
  return {
    name: u.username || u.name || 'User',
    email: u.email || '',
    picture: u.picture || '',
  };
}

/** Normalisasi text untuk ditampilkan. */
function sanitizeDisplayText(htmlText) {
  if (!htmlText) return '';
  const noTags = htmlText.replace(/<[^>]+>/g, ' ');
  const decoded = he.decode(noTags);
  return decoded.replace(/\s+/g, ' ').trim();
}

/** Tulis log JSON tanpa crash; file unik per request. */
function writeDebugLogSafe(dir, data) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `debug-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn('Gagal simpan debug log:', e.message);
  }
}
