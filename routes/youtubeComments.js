/**
 * routes/youtubeComments.js
 * ------------------------------------------------------------
 * Ambil komentar YouTube & filter spam (Manual-only / AI-only).
 * Tentukan apakah user adalah pemilik video → tentukan izin hapus / moderasi.
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

/* ------------------------------------------------------------------ */
/* POST /youtube/get-comments                                         */
/* ------------------------------------------------------------------ */
router.post('/get-comments', authSession, async (req, res) => {
  try {
    const useAi = req.body.useAiJudol === '1' || req.body.useAiJudol === true;
    const youtubeUrl = req.body.youtubeUrl?.trim();
    if (!youtubeUrl) return res.status(400).send('❌ URL YouTube kosong.');

    /* --- Validasi videoId --- */
    const videoId = getVideoIdFromUrl(youtubeUrl);
    if (!videoId) return res.status(400).send('❌ Link YouTube tidak valid.');

    /* --- OAuth --- */
    const credentials = loadYoutubeCredentials();
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

    /* --- Ambil channel milik user login (cached di session) --- */
    let userChannelId = req.session?.userChannelId;
    if (!userChannelId) {
      const chanResp = await youtube.channels.list({ part: 'id', mine: true });
      userChannelId = chanResp?.data?.items?.[0]?.id || null;
      if (req.session) req.session.userChannelId = userChannelId; // cache
      console.log('[youtubeComments] userChannelId:', userChannelId);
    }

    /* --- Ambil info video --- */
    const videoResp = await youtube.videos.list({ part: 'snippet', id: videoId });
    const videoItem = videoResp?.data?.items?.[0];
    if (!videoItem) return res.status(404).send('❌ Video tidak ditemukan.');
    const videoChannelId = videoItem.snippet.channelId;

    const isOwner = userChannelId && videoChannelId && userChannelId === videoChannelId;
    console.log(`[youtubeComments] isOwner? ${isOwner} (user: ${userChannelId} vs video: ${videoChannelId})`);

    /* --- Ambil komentar (pagination) --- */
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

    /* --- Bersihkan teks untuk display --- */
    allComments = allComments.map((c) => ({
      ...c,
      text: sanitizeDisplayText(c.text),
    }));

    if (allComments.length === 0) {
      return res.render('pages/komentar_spam', {
        user: safeUser(req.user),
        comments: [],
        stats: { total: 0, spam: 0, ratio: 0 },
        videoTitle: videoItem.snippet.title,
        videoId,
        useAi,
        isOwner,
      });
    }

    /* ==========================================================
       MODE FILTER
    ========================================================== */
    let spamLabels;
    if (useAi) {
      // AI-only: manual diabaikan
      spamLabels = await getJudolCommentAi(allComments.map((c) => c.text));
    } else {
      // Manual-only
      spamLabels = allComments.map((c) => (getJudolComment(c.text) ? 1 : 0));
    }

    // sinkron panjang (safety)
    while (spamLabels.length < allComments.length) spamLabels.push(0);
    if (spamLabels.length > allComments.length) spamLabels.length = allComments.length;

    /* --- Gabungkan & filter hanya spam --- */
    const commentsWithSpam = allComments.map((c, i) => ({
      ...c,
      isSpam: spamLabels[i] === 1,
      flaggedBy: spamLabels[i] === 1 ? (useAi ? 'ai' : 'manual') : null,
    }));

    const spamOnly = commentsWithSpam.filter((c) => c.isSpam);
    const stats = {
      total: allComments.length,
      spam: spamOnly.length,
      ratio: allComments.length ? ((spamOnly.length / allComments.length) * 100).toFixed(2) : 0,
    };

    /* --- Render: kirim isOwner untuk UI kontrol hapus/report --- */
    res.render('pages/komentar_spam', {
      user: safeUser(req.user),
      comments: spamOnly,
      stats,
      videoTitle: videoItem.snippet.title,
      videoId,
      useAi,
      isOwner, // penting!
    });

    /* --- Debug log optional --- */
    debugLog({
      videoId,
      isOwner,
      useAi,
      total: allComments.length,
      spam: spamOnly.length,
      spamSamples: spamOnly.slice(0, 10).map((c) => ({ id: c.commentId, text: c.text })),
    });

  } catch (err) {
    console.error('YouTube API error:', err);
    res.status(500).send('❌ Gagal mengambil komentar.');
  }
});

/* ------------------------------------------------------------------ */
/* POST /youtube/moderate-comments                                    */
/* Pemilik video: hapus / reject / markSpam langsung lewat YouTube API*/
/* Bukan pemilik: simpan report lokal                                 */
/* ------------------------------------------------------------------ */
router.post('/youtube/moderate-comments', authSession, async (req, res) => {
  try {
    const { action, videoId } = req.body;
    let ids = req.body.ids;
    if (!ids) {
      return res.status(400).json({ success: false, message: 'Tidak ada komentar yang dipilih.' });
    }
    if (typeof ids === 'string') ids = [ids];

    /* --- OAuth --- */
    const credentials = loadYoutubeCredentials();
    const oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      isProductionHttps() ? credentials.redirect_uris[1] : credentials.redirect_uris[0]
    );
    oauth2Client.setCredentials({
      access_token: req.user.access_token,
      refresh_token: req.user.refresh_token,
    });
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    /* --- Dapatkan channel user & channel video --- */
    const userChannelId = await getUserChannelId(youtube, req);
    const videoChannelId = await getVideoChannelId(youtube, videoId);
    const isOwner = userChannelId && videoChannelId && userChannelId === videoChannelId;

    if (!isOwner) {
      // Simpan laporan (non-owner)
      saveReportsLocal(req.user, videoId, ids);
      return res.json({
        success: true,
        message: 'Komentar dilaporkan. Pemilik channel dapat menindaklanjuti.',
        reported: ids.length,
      });
    }

    // Pemilik: eksekusi moderasi
    const promises = [];
    for (const id of ids) {
      if (action === 'delete') {
        promises.push(youtube.comments.delete({ id }));
      } else if (action === 'reject') {
        promises.push(
          youtube.comments.setModerationStatus({
            id,
            moderationStatus: 'rejected',
          })
        );
      } else {
        // default: mark as spam
        promises.push(youtube.comments.markAsSpam({ id }));
      }
    }
    await Promise.allSettled(promises);

    return res.json({
      success: true,
      message: 'Komentar berhasil dimoderasi.',
      count: ids.length,
      action: action || 'spam',
    });
  } catch (err) {
    console.error('Gagal moderasi komentar:', err);
    return res.status(500).json({ success: false, message: 'Gagal memproses komentar.' });
  }
});

module.exports = router;

/* ================================================================== */
/* Helpers                                                            */
/* ================================================================== */

function safeUser(u = {}) {
  return { name: u.username || u.name || 'User', email: u.email || '', picture: u.picture || '' };
}

function sanitizeDisplayText(htmlText) {
  if (!htmlText) return '';
  const noTags = htmlText.replace(/<[^>]+>/g, ' ');
  const decoded = he.decode(noTags);
  return decoded.replace(/\s+/g, ' ').trim();
}

/* Cache channel ID user di session */
async function getUserChannelId(youtube, req) {
  if (req.session?.userChannelId) return req.session.userChannelId;
  const resp = await youtube.channels.list({ part: 'id', mine: true });
  const id = resp?.data?.items?.[0]?.id || null;
  if (req.session) req.session.userChannelId = id;
  return id;
}

/* Ambil channel ID pemilik video */
async function getVideoChannelId(youtube, videoId) {
  if (!videoId) return null;
  const resp = await youtube.videos.list({ part: 'snippet', id: videoId });
  const item = resp?.data?.items?.[0];
  return item?.snippet?.channelId || null;
}

/* Simpan laporan user (non-owner) ke file log */
function saveReportsLocal(user, videoId, commentIds) {
  try {
    const dir = path.join(__dirname, '../logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'reports.json');

    let existing = [];
    if (fs.existsSync(file)) {
      try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { existing = []; }
    }

    existing.push({
      ts: new Date().toISOString(),
      user: { email: user.email, name: user.username || user.name || '' },
      videoId,
      commentIds,
    });

    fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  } catch (e) {
    console.error('⚠ Gagal simpan report lokal:', e.message);
  }
}

/* Debug log optional */
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
