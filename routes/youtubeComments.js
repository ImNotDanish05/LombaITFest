/**
 * routes/youtubeComments.js
 * ------------------------------------------------------------
 * Ambil komentar YouTube, filter spam:
 *  - Manual-only (default)
 *  - AI-only saat checkbox useAiJudol=1
 */

const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

let he;
try {
  he = require('he');
} catch {
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

/* ---------------- Route: /youtube/get-comments ---------------- */
router.post('/get-comments', authSession, async (req, res) => {
  try {
    const useAi = req.body.useAiJudol === '1' || req.body.useAiJudol === true;
    const youtubeUrl = req.body.youtubeUrl?.trim();
    if (!youtubeUrl) return res.status(400).send('❌ URL YouTube kosong.');

    const credentials = loadYoutubeCredentials();
    const videoId = getVideoIdFromUrl(youtubeUrl);
    if (!videoId) return res.status(400).send('❌ Link YouTube tidak valid.');

    /* OAuth */
    const oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      isProductionHttps() ? credentials.redirect_uris[1] : credentials.redirect_uris[0]
    );
    oauth2Client.setCredentials({
      access_token: req.user.access_token,
      refresh_token: req.user.refresh_token,
    });
    try { await oauth2Client.getAccessToken(); }
    catch (refreshError) {
      console.warn('⚠ Refresh token...', refreshError?.message);
      const tokens = await oauth2Client.refreshAccessToken();
      oauth2Client.setCredentials(tokens.credentials);
    }

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    /* Info Video */
    const videoResponse = await youtube.videos.list({ part: 'snippet', id: videoId });
    const videoItem = videoResponse?.data?.items?.[0];
    if (!videoItem) return res.status(404).send('❌ Video tidak ditemukan.');

    /* Ambil Komentar (pagination) */
    let allComments = [];
    let nextPageToken = null;
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
      }));

      allComments = allComments.concat(commentsBatch);
      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    /* Bersihkan teks untuk display */
    allComments = allComments.map((c) => ({
      ...c,
      text: sanitizeDisplayText(c.text),
    }));

    /* Jika tidak ada komentar */
    if (allComments.length === 0) {
      return res.render('pages/komentar_spam', {
        user: safeUser(req.user),
        comments: [],
        stats: { total: 0, spam: 0, ratio: 0 },
        videoTitle: videoItem.snippet.title,
        videoId,
        useAi,
      });
    }

    /* ================= FILTER MODE ================= */
    let spamLabels = [];

    if (useAi) {
      // AI-only: manual diabaikan
      spamLabels = await getJudolCommentAi(allComments.map((c) => c.text));
    } else {
      // Manual-only
      spamLabels = allComments.map((c) => (getJudolComment(c.text) ? 1 : 0));
    }

    // sinkron panjang
    while (spamLabels.length < allComments.length) spamLabels.push(0);
    if (spamLabels.length > allComments.length) spamLabels.length = allComments.length;

    /* Gabungkan & filter hanya spam */
    const commentsWithSpam = allComments.map((c, i) => ({
      ...c,
      isSpam: spamLabels[i] === 1,
      flaggedBy: spamLabels[i] === 1 ? (useAi ? 'ai' : 'manual') : null,
    }));

    const spamOnly = commentsWithSpam.filter((c) => c.isSpam);

    const stats = {
      total: allComments.length,
      spam: spamOnly.length,
      ratio: allComments.length > 0 ? ((spamOnly.length / allComments.length) * 100).toFixed(2) : 0,
    };

    /* Render */
    res.render('pages/komentar_spam', {
      user: safeUser(req.user),
      comments: spamOnly,
      stats,
      videoTitle: videoItem.snippet.title,
      videoId,
      useAi,
    });

    /* Simpan debug */
    debugLog({
      videoId,
      total: allComments.length,
      spam: spamOnly.length,
      useAi,
      commentsSpam: spamOnly.map((c) => ({ id: c.commentId, flaggedBy: c.flaggedBy, text: c.text })),
    });

  } catch (err) {
    console.error('YouTube API error:', err);
    res.status(500).send('❌ Gagal mengambil komentar.');
  }
});

module.exports = router;

/* ---------------- Helpers ---------------- */
function safeUser(u = {}) {
  return { name: u.username || u.name || 'User', email: u.email || '', picture: u.picture || '' };
}

function sanitizeDisplayText(htmlText) {
  if (!htmlText) return '';
  const noTags = htmlText.replace(/<[^>]+>/g, ' ');
  const decoded = he.decode(noTags);
  return decoded.replace(/\s+/g, ' ').trim();
}

function debugLog(data) {
  if (process.env.DEBUG_JUDOL_LOG !== '1') return;
  try {
    const dir = path.join(__dirname, '../logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `youtubeComments-${Date.now()}.json`),
      JSON.stringify(data, null, 2)
    );
  } catch (e) {
    console.warn('Gagal simpan debug log:', e.message);
  }
}
