const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const fs = require('fs');
const { getVideoIdFromUrl } = require('../controllers/youtube/index');
const { getJudolComment, getJudolCommentAi } = require('../controllers/comment_get_judol');
const { authSession } = require('../controllers/authSession');
const { loadYoutubeCredentials } = require('../utils/LoadData');
const isProductionHttps = require('../utils/isProductionHttps');

router.post('/get-comments', authSession, async (req, res) => {
  try {
    const useAi = req.body.useAiJudol === '1';
    const youtubeUrl = req.body.youtubeUrl;
    const credentials = loadYoutubeCredentials();
    const match = getVideoIdFromUrl(youtubeUrl);
    if (!match) return res.status(400).send('Link YouTube tidak valid.');
    const videoId = match;

    const oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      isProductionHttps() ? credentials.redirect_uris[1] : credentials.redirect_uris[0]
    );
    oauth2Client.setCredentials({
      access_token: req.user.access_token,
      refresh_token: req.user.refresh_token
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // HANYA AMBIL VIDEO INFO (tidak perlu channel user)
    const videoResponse = await youtube.videos.list({
      part: 'snippet',
      id: videoId
    });

    const videoItem = videoResponse?.data?.items?.[0];
    if (!videoItem) {
      return res.status(404).send('Video tidak ditemukan.');
    }

    // Kita tidak cek kepemilikan channel lagi
    const isOwner = false;

    // 🔄 AMBIL KOMENTAR
    let allComments = [], nextPageToken = null;
    do {
      const response = await youtube.commentThreads.list({
        part: 'snippet',
        videoId,
        maxResults: 100,
        pageToken: nextPageToken || ''
      });

      if (!response?.data?.items) break;

      const commentsBatch = response.data.items.map(item => ({
        text: item.snippet.topLevelComment.snippet.textDisplay,
        commentId: item.snippet.topLevelComment.id
      }));

      allComments = allComments.concat(commentsBatch);
      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    const manualResults = allComments.map(c => getJudolComment(c.text));
    const notDetectedManually = allComments.filter((c, i) => !manualResults[i]).map(c => c.text);

    let aiResults = [];
    if (useAi && notDetectedManually.length > 0) {
      aiResults = await getJudolCommentAi(notDetectedManually);
    }

    let spamResults = [];
    let aiIdx = 0;
    for (let i = 0; i < allComments.length; i++) {
      if (manualResults[i]) {
        spamResults.push(1);
      } else {
        spamResults.push(useAi ? (aiResults[aiIdx++] || 0) : 0);
      }
    }

    const cleanAllComments = allComments.map(c => ({
      ...c,
      text: c.text.replace(/<[^>]+>/g, ' ')
    }));

    const commentsWithSpam = cleanAllComments.map((c, i) => ({
      ...c,
      isSpam: spamResults[i]
    }));

    const onlySpamComments = commentsWithSpam.filter(c => c.isSpam);

    // Simpan debug log
    const debugData = { semuaKomentar: onlySpamComments };
    fs.writeFileSync('debug-log.json', JSON.stringify(debugData, null, 2), 'utf-8');

    res.render('pages/komentar_spam', {
      user: {
        name: req.user.username,
        email: req.user.email,
        picture: req.user.picture,
        isOwner: isOwner
      },
      comments: onlySpamComments
    });
  } catch (err) {
    console.error('YouTube API error:', err);
    res.status(500).send('Gagal mengambil komentar.');
  }
});

module.exports = router;
