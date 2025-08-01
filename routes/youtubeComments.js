/**
 * routes/youtubeComments.js
 * ------------------------------------------------------------
 * Ambil komentar YouTube & filter spam (Manual-only / AI-only).
 * Tentukan apakah user adalah pemilik video → izin hapus / moderasi.
 * Versi: debug delete enhanced.
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
router.post('/get-comments', authSession, async (req, res, next) => {
  try {
      const io = req.app.get('io');
      const socketId = req.body.socketId; // ambil ID socket dari frontend

      function emitProgress(msg) {
        if (socketId && io) {
          io.to(socketId).emit('progress', msg);
        }
      }
      emitProgress('Memulai proses ambil komentar...');
      const useAi = req.body.useAiJudol === '1' || req.body.useAiJudol === true;
      const youtubeUrl = req.body.youtubeUrl?.trim();
      const user = req.user

      emitProgress('Memeriksa URL YouTube...');
      if (!youtubeUrl) {
        const err = new Error('❌ URL YouTube kosong.');
        err.status = 400;
        err.backUrl = '/judolremover';  // agar tombol kembali ke form input
        return next(err);
      }

      emitProgress('Mengekstrak ID video dari URL...');
      const videoId = getVideoIdFromUrl(youtubeUrl);
      console.log (videoId, youtubeUrl);
      if (!videoId) {
        const err = new Error('❌ link video youtube tidak valid.');
        err.status = 400;
        err.backUrl = '/judolremover';  // agar tombol kembali ke form input
        return next(err);
      }

      /* --- OAuth --- */
      emitProgress('Mengautentikasi dengan YouTube API...');
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
          try {
            const tokens = await oauth2Client.refreshAccessToken();
            oauth2Client.setCredentials(tokens.credentials);
          } catch (refreshFail) {
            console.error('❌ Refresh token gagal:', refreshFail.message);
            // Logout user langsung
            return res.redirect('/logout');
          }
        } else {
          // Tidak ada refresh token → langsung logout
          return res.redirect('/logout');
        }
      }

      if (process.env.DEBUG_JUDOL_LOG === '1') {
        console.log('[get-comments] token scopes:', oauth2Client.credentials.scope);
      }

      const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

      emitProgress('Mengecek kepemilikan video...');
      /* --- Channel user (cache) --- */
      let userChannelId = req.session?.userChannelId;
      if (!userChannelId) {
        const chanResp = await youtube.channels.list({ part: 'id', mine: true, auth: oauth2Client });
        userChannelId = chanResp?.data?.items?.[0]?.id;
        // if (req.session) req.session.userChannelId = userChannelId;
        console.log('[get-comments] userChannelId:', userChannelId);
      }

      /* --- Info video --- */
      const videoResp = await youtube.videos.list({ part: 'snippet,statistics', id: videoId });
      const videoItem = videoResp?.data?.items?.[0];
      if (!videoItem) {
        const err = new Error('❌ Tidak menemukan video.');
        err.status = 400;
        err.backUrl = '/judolremover';  // agar tombol kembali ke form input
        return next(err);
      }
      
      const videoChannelId = videoItem.snippet.channelId;

      const isOwner = userChannelId && videoChannelId && userChannelId === videoChannelId;
      console.log(`[get-comments] isOwner? ${isOwner} (user: ${userChannelId} vs video: ${videoChannelId})`);

      /* --- Ambil komentar (pagination) --- */
      emitProgress('Mengambil komentar dari YouTube...');
      let allComments = [];
      let nextPageToken = null;
      do {
        emitProgress(`Mengambil komentar ke ${allComments.length}...`);
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
          commentId: item.snippet.topLevelComment.id, // penting: ID komentar
          author: item.snippet.topLevelComment.snippet.authorDisplayName,
          publishedAt: item.snippet.topLevelComment.snippet.publishedAt,
        }));

        allComments = allComments.concat(commentsBatch);
        nextPageToken = response.data.nextPageToken;
      } while (nextPageToken);

      
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
      // 1. Manual check (selalu dilakukan)
      emitProgress('Memeriksa komentar menggunakan Basic AI...');
      const manualLabels = allComments.map((c, i) => {
        emitProgress(`🔎 Memeriksa komentar ke-${i + 1} dari ${allComments.length}`);
        return getJudolComment(c.text) ? 1 : 0;
      });

      // 2. Jalankan AI untuk komentar yang lolos manual
      emitProgress('Memeriksa komentar menggunakan Gemini AI...');
      const aiLabelsFull = new Array(allComments.length).fill(0); // default 0
      if (useAi) {
        const textsForAi = [];
        const indexMap = [];

        manualLabels.forEach((label, idx) => {
          if (label === 0) { // hanya komentar lolos manual
            textsForAi.push(allComments[idx].text);
            indexMap.push(idx);
          }
          emitProgress(`Menyiapkan data untuk tahap Gemini AI ${textsForAi.length}/${allComments.length}...`);
        });

        if (textsForAi.length > 0) {
          emitProgress('Memeriksa komentar dengan Gemini AI (Tunggu sekitar 2-3 menit)...');
          const aiResults = await getJudolCommentAi(textsForAi); // [0/1]
          aiResults.forEach((res, i) => {
            aiLabelsFull[indexMap[i]] = res; // tempatkan hasil AI ke posisi aslinya
          });
        }
      }

      // 3. Gabungkan ke spamLabels final
      emitProgress('Menggabungkan hasil manual dan AI...');
      const spamLabels = allComments.map((_, i) => (manualLabels[i] === 1 || aiLabelsFull[i] === 1) ? 1 : 0);


      /* --- Bersihkan untuk display --- */
      allComments = allComments.map((c) => ({
      ...c,
      text: sanitizeDisplayText(c.text),
      }));

      while (spamLabels.length < allComments.length) spamLabels.push(0);
      if (spamLabels.length > allComments.length) spamLabels.length = allComments.length;

      
      const commentsWithSpam = allComments.map((c, i) => {
        let flaggedBy = null;
        emitProgress(`Mempersiapkan data untuk tampilan ${i + 1}/${allComments.length}...`);
        if (manualLabels[i] === 1) {
          flaggedBy = 'Basic AI';
        } else if (aiLabelsFull[i] === 1) {
          flaggedBy = 'Gemini AI';
        }

        return {
          ...c,
          isSpam: spamLabels[i] === 1,
          flaggedBy,
        };
      });

      const spamOnly = commentsWithSpam.filter((c) => c.isSpam);
      const stats = {
        total: allComments.length,
        spam: spamOnly.length,
        ratio: allComments.length
          ? ((spamOnly.length / allComments.length) * 100).toFixed(2)
          : 0,
      };
      emitProgress('Selesai memproses komentar. Tunggu sebentar...');
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
      next(err);
    }
});




/* ------------------------------------------------------------------ */
/* POST /youtube/moderate-comments                                    */
/* ------------------------------------------------------------------ */

router.post('/youtube/moderate-comments', authSession, async (req, res, next) => {
  try {
    let success = false;
    let permanentDelete = false;
    const { action, videoId } = req.body;
    let ids = req.body.ids;
    const user = req.user;

    if (!ids) {
      const err = new Error('❌ Tidak ada Komentar yang dipilih');
      err.status = 400;
      err.backUrl = '/judolremover';
      return next(err);
    }

    if (typeof ids === 'string') ids = [ids];
    ids = ids.filter(id => typeof id === 'string' && id.trim() !== '');
    if (ids.length === 0) {
      const err = new Error('❌ Daftar komentar kosong.');
      err.status = 400;
      return next(err);
    }

    console.log("[moderate] Action=%s totalIds=%d firstIds=%s", action, ids.length, ids.join(","));

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

    // Ownership check
    const userChannelId = await getUserChannelId(youtube, req);
    const videoChannelId = await getVideoChannelId(youtube, videoId);
    const isOwner = userChannelId && videoChannelId && userChannelId === videoChannelId;
    let failedCount = 0;
    const failures = [];

    if (!isOwner) {
      if (action !== 'spam') {
        const err = new Error('❌ Bukan pemilik video.');
        err.status = 403;
        err.backUrl = '/dashboard';
        return next(err);
      } else {
        for (const id of ids) {
          try {
            await youtube.comments.markAsSpam({ id });
            console.log(`⚑ Marked as spam: ${id}`);
          } catch (err) {
            failedCount++;
            const info = describeGapiError(err);
            console.error(`❌ Mark spam gagal (${id}):`, info.short);
            failures.push({ id, ...info });
          }
        }
        success = failedCount === 0;
        return res.render('pages/success', {
          message: 'Komentar berhasil dilaporkan ke youtube.',
          action: 'spam',
          isOwner,
          success,
          failedCount,
          permanentDelete,
          selectedIds: ids.length,
          user: user
        });
      }
    }

    const allowedOwnerActions = new Set(['delete', 'reject', 'spam']);
    if (!allowedOwnerActions.has(action)) {
      const err = new Error('❌ Aksi tidak valid.');
      err.status = 404;
      err.backUrl = '/judolremover';
      return next(err);
    }

    // Optional verify
    if (process.env.VERIFY_DELETE_ID === '1' && action === 'delete') {
      console.log('[moderate] Verifikasi sample ID komentar...');
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

    console.log(`[moderate] Action=${action} totalIds=${ids.length} firstIds=${ids.slice(0, 5).join(',')}`);

    
    let message = '';
    if (action === 'delete') {
      message = `Komentar berhasil dihapus secara permanen.`;
      for (const id of ids) {
        try {
          await youtube.comments.delete({ id });
          permanentDelete = true;
          console.log(`🗑️ Deleted comment: ${id}`);
        } catch (err) {
          failedCount++;
          const info = describeGapiError(err);
          console.error(`❌ Delete gagal (${id}):`, info.short);
          failures.push({ id, ...info });
        }
      }
    } else if (action === 'reject') {
      message = `Komentar berhasil disembunyikan.`;
      for (const id of ids) {
        try {
          await youtube.comments.setModerationStatus({
            id,
            moderationStatus: 'rejected',
          });
          console.log(`🚫 Rejected comment: ${id}`);
        } catch (err) {
          failedCount++;
          const info = describeGapiError(err);
          console.error(`❌ Reject gagal (${id}):`, info.short);
          failures.push({ id, ...info });
        }
      }
    } else if (action === 'spam') {
      message = `Komentar berhasil direport sebagai spam ke youtube`;
      for (const id of ids) {
        try {
          await youtube.comments.markAsSpam({ id });
          console.log(`⚑ Marked as spam: ${id}`);
        } catch (err) {
          failedCount++;
          const info = describeGapiError(err);
          console.error(`❌ Mark spam gagal (${id}):`, info.short);
          failures.push({ id, ...info });
        }
      }
    }
    
    success = failedCount === 0;
    
    return res.render('pages/success', {
      message: success ?
      message : `Beberapa komentar gagal diproses.`,
      isOwner,
      success,
      action,
      failedCount,
      permanentDelete,
      selectedIds: ids.length,
      user: user
    });

  } catch (err) {
    console.error('Gagal moderasi komentar (fatal):', err);
    err.status = 500;
    err.backUrl = '/judolremover';
    return next(err);
  }
});

/*
router.post('/youtube/moderate-comments', authSession, async (req, res, next) => {
  try {
    let permanentDelete = false;
    const { action, videoId } = req.body;
    let ids = req.body.ids;
    let selectedIds = ids;
    const user = req.user;
    if (!ids) {
      const err = new Error('❌ Tidak ada Komentar yang dipilih');
      err.status = 400;
      err.backUrl = '/judolremover';  // agar tombol kembali ke form input
      return next(err);
    }
    if (typeof ids === 'string') ids = [ids];
    console.log("[moderate] Action=%s totalIds=%d firstIds=%s", action, ids.length, ids.join(","));


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

    // Ownership check
    const userChannelId = await getUserChannelId(youtube, req);
    const videoChannelId = await getVideoChannelId(youtube, videoId);
    const isOwner =
      userChannelId && videoChannelId && userChannelId === videoChannelId;

    if (!isOwner) {
      if (action !== 'report') {
        const err = new Error('❌ Bukan pemilik video.');
        err.status = 403;
        err.backUrl = '/dashboard';  // agar tombol kembali ke form input
        return next(err);
      }
      else {
        saveReportsLocal(req.user, videoId, ids);
        res.render('pages/success', {
        message: 'Komentar berhasil dilaporkan ke youtube.',
        isOwner,
        permanentDelete,
        selectedIds: selectedIds.length,
        user:user
      })}
      };

    const allowedOwnerActions = new Set(['delete', 'reject', 'spam']);
    if (!allowedOwnerActions.has(action)) {
      const err = new Error('❌ Aksi tidak valid.');
      err.status = 404;
      err.backUrl = '/judolremover';  // agar tombol kembali ke form input
      return next(err);
    }

    // Optional verify
    if (process.env.VERIFY_DELETE_ID === '1' && action === 'delete') {
      console.log('[moderate] Verifikasi sample ID komentar...');
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

    console.log(`[moderate] Action=${action} totalIds=${ids.length} firstIds=${ids.slice(0,5).join(',')}`);

    let failedCount = 0;
    const failures = [];
    

    if (action === 'delete') {
      for (const id of ids) {
        try {
          await youtube.comments.delete({ id });
          permanentDelete = true;
          console.log(`🗑️ Deleted comment: ${id}`);
        } catch (err) {
          failedCount++;
          const info = describeGapiError(err);
          console.error(`❌ Delete gagal (${id}):`, info.short);
          failures.push({ id, ...info });
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
          const info = describeGapiError(err);
          console.error(`❌ Reject gagal (${id}):`, info.short);
          failures.push({ id, ...info });
        }
      }
    } else if (action === 'spam') {
      for (const id of ids) {
        try {
          await youtube.comments.markAsSpam({ id });
          console.log(`⚑ Marked as spam: ${id}`);
        } catch (err) {
          failedCount++;
          const info = describeGapiError(err);
          console.error(`❌ Mark spam gagal (${id}):`, info.short);
          failures.push({ id, ...info });
        }
      }
    }

    const success = failedCount === 0;
    res.render('pages/success', {
      message: success
        ? `Komentar berhasil dimoderasi.`
        : `Beberapa komentar gagal diproses.`,
      isOwner,
      permanentDelete,
      selectedIds: selectedIds.length,
      user:user
    });
  } catch (err) {
    console.error('Gagal moderasi komentar (fatal):', err);
    err.status = 500;
    err.backUrl = '/judolremover';  // agar tombol kembali ke form input
    return next(err);
  }
});
*/

/* ------------------------------------------------------------------ */
/* OPTIONAL DEBUG: GET /youtube/debug-comment/:id                     */
/* Aktifkan dengan DEBUG_JUDOL_LOG=1                                  */
/* ------------------------------------------------------------------ */
// if (process.env.DEBUG_JUDOL_LOG === '1') {
//   router.get('/youtube/debug-comment/:id', authSession, async (req, res) => {
//     try {
//       const { id } = req.params;
//       const videoId = req.query.videoId;
//       const credentials = loadYoutubeCredentials();
//       const oauth2Client = new google.auth.OAuth2(
//         credentials.client_id,
//         credentials.client_secret,
//         isProductionHttps() ? credentials.redirect_uris[1] : credentials.redirect_uris[0]
//       );
//       oauth2Client.setCredentials({
//         access_token: req.user.access_token,
//         refresh_token: req.user.refresh_token,
//       });
//       const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
//       const resp = await youtube.comments.list({ part: 'snippet', id });
//       res.json({ id, items: resp.data.items || [], videoId });
//     } catch (e) {
//       res.status(500).json({ error: e.message });
//     }
//   });
// }

// router.get('/youtube/check-comment/:id', authSession, async (req, res) => {
//   try {
//     const { id } = req.params;
//     const credentials = loadYoutubeCredentials();
//     const oauth2Client = new google.auth.OAuth2(
//       credentials.client_id,
//       credentials.client_secret,
//       isProductionHttps() ? credentials.redirect_uris[1] : credentials.redirect_uris[0]
//     );
//     oauth2Client.setCredentials({
//       access_token: req.user.access_token,
//       refresh_token: req.user.refresh_token,
//     });
//     const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

//     // Panggil YouTube API untuk cek comment ID
//     const resp = await youtube.comments.list({
//       part: 'snippet',
//       id,
//     });
//     res.json(resp.data);
//   } catch (err) {
//     console.error('Error check-comment:', err);
//     res.status(500).json({ error: err.message, details: err.errors });
//   }
// });

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

/**
 * Ekstrak detail error YouTube API (Google API) dengan ringkas.
 */
function describeGapiError(err) {
  let reason = null;
  let message = err?.message || null;
  let domain = null;
  let location = null;
  let status = err?.code || null;

  // Beberapa library meletakkan detail di err.errors
  if (Array.isArray(err?.errors) && err.errors.length) {
    const e0 = err.errors[0];
    reason = e0.reason || reason;
    message = e0.message || message;
    domain = e0.domain || domain;
    location = e0.location || location;
  }

  // Format respons axios-like (err.response.data.error)
  if (err?.response?.data?.error) {
    const g = err.response.data.error;
    if (Array.isArray(g.errors) && g.errors.length) {
      const e0 = g.errors[0];
      reason = reason || e0.reason;
      domain = domain || e0.domain;
      message = message || e0.message;
      location = location || e0.location;
    } else {
      message = message || g.message;
    }
    status = g.code || status;
  }

  // Keterangan ringkas
  const short = `[reason=${reason || 'n/a'} status=${status || 'n/a'}] ${message || 'no-message'}`;

  return { reason, message, status, domain, location, short, rawType: err?.name };
}
