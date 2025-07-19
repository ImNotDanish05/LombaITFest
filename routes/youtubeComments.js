/**
 * routes/youtubeComments.js
 * ------------------------------------------------------------
 * Ambil komentar YouTube & filter spam (Manual-only / AI-only).
 * Tentukan apakah user adalah pemilik video → izin hapus / moderasi.
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

    try {
      await oauth2Client.getAccessToken();
    } catch (refreshError) {
      console.warn('⚠ Refresh token (get-comments) gagal:', refreshError?.message);
      if (oauth2Client.credentials.refresh_token) {
        const tokens = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(tokens.credentials);
      }
    }

    if (process.env.DEBUG_JUDOL_LOG === '1') {
      console.log('[get-comments] token scopes:', oauth2Client.credentials.scope);
    }

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    /* --- Channel user (cache) --- */
    let userChannelId = req.session?.userChannelId;
    if (!userChannelId) {
      const chanResp = await youtube.channels.list({ part: 'id', mine: true });
      userChannelId = chanResp?.data?.items?.[0]?.id || null;
      if (req.session) req.session.userChannelId = userChannelId;
      console.log('[get-comments] userChannelId:', userChannelId);
    }

    /* --- Info video --- */
    const videoResp = await youtube.videos.list({ part: 'snippet', id: videoId });
    const videoItem = videoResp?.data?.items?.[0];
    if (!videoItem) return res.status(404).send('❌ Video tidak ditemukan.');
    const videoChannelId = videoItem.snippet.channelId;

    const isOwner = userChannelId && videoChannelId && userChannelId === videoChannelId;
    console.log(`[get-comments] isOwner? ${isOwner} (user: ${userChannelId} vs video: ${videoChannelId})`);

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
        commentId: item.snippet.topLevelComment.id, // ID komentar (bukan thread id)
        author: item.snippet.topLevelComment.snippet.authorDisplayName,
        publishedAt: item.snippet.topLevelComment.snippet.publishedAt,
      }));

      allComments = allComments.concat(commentsBatch);
      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    /* --- Bersihkan untuk display --- */
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

    /* --- Filtering --- */
    let spamLabels;
    if (useAi) {
      spamLabels = await getJudolCommentAi(allComments.map((c) => c.text));
    } else {
      spamLabels = allComments.map((c) => (getJudolComment(c.text) ? 1 : 0));
    }

    while (spamLabels.length < allComments.length) spamLabels.push(0);
    if (spamLabels.length > allComments.length) spamLabels.length = allComments.length;

    const commentsWithSpam = allComments.map((c, i) => ({
      ...c,
      isSpam: spamLabels[i] === 1,
      flaggedBy: spamLabels[i] === 1 ? (useAi ? 'ai' : 'manual') : null,
    }));

    const spamOnly = commentsWithSpam.filter((c) => c.isSpam);
    const stats = {
      total: allComments.length,
      spam: spamOnly.length,
      ratio: allComments.length
        ? ((spamOnly.length / allComments.length) * 100).toFixed(2)
        : 0,
    };

    res.render('pages/komentar_spam', {
      user: safeUser(req.user),
      comments: spamOnly,
      stats,
      videoTitle: videoItem.snippet.title,
      videoId,
      useAi,
      isOwner,
    });

    debugLog({
      videoId,
      isOwner,
      useAi,
      total: allComments.length,
      spam: spamOnly.length,
      commentIdsSample: spamOnly.slice(0, 5).map((c) => c.commentId),
    });
  } catch (err) {
    console.error('YouTube API error (get-comments):', err);
    res.status(500).send('❌ Gagal mengambil komentar.');
  }
});

/* ------------------------------------------------------------------ */
/* POST /youtube/moderate-comments                                    */
/* ------------------------------------------------------------------ */
router.post('/youtube/moderate-comments', authSession, async (req, res) => {
  try {
    const { action, videoId } = req.body;
    let ids = req.body.ids;
    if (!ids) {
      return res
        .status(400)
        .json({ success: false, message: 'Tidak ada komentar yang dipilih.' });
    }
    if (typeof ids === 'string') ids = [ids];

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

    try {
      await oauth2Client.getAccessToken();
    } catch (refreshError) {
      console.warn('⚠ Refresh token (moderate) gagal:', refreshError?.message);
      if (oauth2Client.credentials.refresh_token) {
        const tokens = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(tokens.credentials);
      }
    }

    if (process.env.DEBUG_JUDOL_LOG === '1') {
      console.log('[moderate] token scopes:', oauth2Client.credentials.scope);
    }

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Ownership check ulang
    const userChannelId = await getUserChannelId(youtube, req);
    const videoChannelId = await getVideoChannelId(youtube, videoId);
    const isOwner =
      userChannelId && videoChannelId && userChannelId === videoChannelId;

    if (!isOwner) {
      // Hanya boleh REPORT
      if (action !== 'report') {
        return res
          .status(403)
          .json({ success: false, message: 'Bukan pemilik video.' });
      }
      saveReportsLocal(req.user, videoId, ids);
      return res.json({
        success: true,
        message: 'Komentar dilaporkan. Pemilik channel dapat menindaklanjuti.',
        reported: ids.length,
        action: 'report',
      });
    }

    const allowedOwnerActions = new Set(['delete', 'reject', 'spam']);
    if (!allowedOwnerActions.has(action)) {
      return res
        .status(400)
        .json({ success: false, message: 'Action tidak valid.' });
    }

    // (Opsional) verifikasi ID sebelum eksekusi (aktifkan dengan VERIFY_DELETE_ID=1)
    if (process.env.VERIFY_DELETE_ID === '1') {
      console.log('[moderate] Verifikasi ID komentar (sample max 10)...');
      const sample = ids.slice(0, 10);
      try {
        const verifyResp = await youtube.comments.list({
          part: 'snippet',
          id: sample.join(','),
          maxResults: sample.length,
        });
        const returned = (verifyResp.data.items || []).map((i) => i.id);
        console.log('[moderate] verify returned:', returned);
      } catch (verErr) {
        console.warn('Verifikasi ID gagal:', verErr.message);
      }
    }

    let failedCount = 0;
    const failures = [];

    if (action === 'delete') {
      for (const id of ids) {
        try {
          await youtube.comments.delete({ id });
          console.log(`🗑️ Deleted comment: ${id}`);
        } catch (err) {
          failedCount++;
          const r = extractYouTubeReason(err);
            console.error(`❌ Delete gagal (${id}):`, r || err.message);
          failures.push({ id, reason: r || err.message });
        }
      }
    } else if (action === 'reject') {
      for (const id of ids) {
        try {
          await youtube.comments.setModerationStatus({
            id,
            moderationStatus: 'rejected',
          });
          console.log(`🚫 Rejected comment: ${id}`);
        } catch (err) {
          failedCount++;
          const r = extractYouTubeReason(err);
          console.error(`❌ Reject gagal (${id}):`, r || err.message);
          failures.push({ id, reason: r || err.message });
        }
      }
    } else if (action === 'spam') {
      for (const id of ids) {
        try {
          await youtube.comments.markAsSpam({ id });
          console.log(`⚑ Marked as spam: ${id}`);
        } catch (err) {
          failedCount++;
          const r = extractYouTubeReason(err);
          console.error(`❌ Mark spam gagal (${id}):`, r || err.message);
          failures.push({ id, reason: r || err.message });
        }
      }
    }

    const success = failedCount === 0;
    return res.json({
      success,
      message: success
        ? `Komentar berhasil dimoderasi.`
        : `Beberapa komentar gagal diproses.`,
      action,
      totalRequested: ids.length,
      totalSuccess: ids.length - failedCount,
      totalFailed: failedCount,
      failures,
    });
  } catch (err) {
    console.error('Gagal moderasi komentar (fatal):', err);
    return res
      .status(500)
      .json({ success: false, message: 'Gagal memproses komentar.' });
  }
});

module.exports = router;

/* ================================================================== */
/* Helpers                                                            */
/* ================================================================== */

function safeUser(u = {}) {
  return {
    name: u.username || u.name || 'User',
    email: u.email || '',
    picture: u.picture || '',
  };
}

function sanitizeDisplayText(htmlText) {
  if (!htmlText) return '';
  const noTags = htmlText.replace(/<[^>]+>/g, ' ');
  const decoded = he.decode(noTags);
  return decoded.replace(/\s+/g, ' ').trim();
}

async function getUserChannelId(youtube, req) {
  if (req.session?.userChannelId) return req.session.userChannelId;
  const resp = await youtube.channels.list({ part: 'id', mine: true });
  const id = resp?.data?.items?.[0]?.id || null;
  if (req.session) req.session.userChannelId = id;
  return id;
}

async function getVideoChannelId(youtube, videoId) {
  if (!videoId) return null;
  const resp = await youtube.videos.list({ part: 'snippet', id: videoId });
  const item = resp?.data?.items?.[0];
  return item?.snippet?.channelId || null;
}

function saveReportsLocal(user, videoId, commentIds) {
  try {
    const dir = path.join(__dirname, '../logs');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'reports.json');

    let existing = [];
    if (fs.existsSync(file)) {
      try {
        existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        existing = [];
      }
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

function extractYouTubeReason(err) {
  try {
    if (err && err.errors && err.errors[0] && err.errors[0].reason) {
      return err.errors[0].reason;
    }
    if (err && err.response && err.response.data && err.response.data.error) {
      const errData = err.response.data.error;
      if (Array.isArray(errData.errors) && errData.errors[0]?.reason) {
        return errData.errors[0].reason;
      }
      return errData.message;
    }
  } catch (_) {}
  return null;
}
