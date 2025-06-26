const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const CREDENTIALS_PATH = path.join(__dirname, 'credentials_youtube_api.json');
const TOKEN_PATH = path.join(__dirname, 'user_token.json');
const BLOCKED_WORDS_PATH = path.join(__dirname, 'blockedword.json');
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'openid',
  'email',
  'profile'
];

const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const { client_secret, client_id, redirect_uris } = credentials.web;

const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uris[0]
);

// Fungsi untuk mengambil videoId dari link YouTube
function getVideoIdFromUrl(url) {
  if (!url) return null;
  // Mendukung format: https://www.youtube.com/watch?v=xxxx atau youtu.be/xxxx
  const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
  return match ? match[1] : null;
}

app.get('/start', async (req, res) => {
  if (!fs.existsSync(TOKEN_PATH)) {
    return res.send('Belum login. <a href="/login">Login dulu</a>');
  }

  try {
    const tokenData = JSON.parse(fs.readFileSync(TOKEN_PATH));
    oauth2Client.setCredentials({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expiry_date: tokenData.expire
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const videoUrl = process.env.YOUTUBE_CHANNEL_ID;

    if (!videoUrl) {
      return res.status(400).send('YOUTUBE_CHANNEL_ID tidak ditemukan di .env');
    }

    const videoId = getVideoIdFromUrl(videoUrl);

    if (!videoId) {
      return res.status(400).send('Link YouTube tidak valid di .env');
    }

    const titleRes = await youtube.videos.list({
      part: 'snippet',
      id: videoId
    });

    const title = titleRes.data.items[0]?.snippet?.title || 'Video';

    console.log(`📺 Mengecek video: ${title} (${videoId})`);

    const spamComments = await getSpamComments(youtube, videoId);
    let totalSpam = 0;
    if (spamComments.length > 0) {
      console.log(`🚨 ${spamComments.length} komentar spam ditemukan. Menghapus...`);
      await deleteComments(youtube, spamComments);
      totalSpam = spamComments.length;
    } else {
      console.log('✅ Tidak ada komentar spam.');
    }

    res.send(`<h1>✅ Selesai</h1><p>Total komentar spam yang dihapus: <strong>${totalSpam}</strong></p>`);
  } catch (err) {
    console.error('Error saat membersihkan:', err.response?.data || err.message || err);
    res.status(500).send('Terjadi kesalahan saat membersihkan komentar.');
  }
});

app.get('/login', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Kode tidak ditemukan');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: client_id
    });

    const payload = ticket.getPayload();

    const userData = {
      google_id: payload.sub,
      email: payload.email,
      username: payload.name,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      expire: tokens.expiry_date || null,
      scope: Array.isArray(tokens.scope)
        ? tokens.scope
        : (tokens.scope ? tokens.scope.split(' ') : SCOPES),
      token_type: tokens.token_type || 'Bearer',
      created_at: new Date().toISOString()
    };

    fs.writeFileSync(TOKEN_PATH, JSON.stringify(userData, null, 2));

    const expiredAt = userData.expire ? new Date(userData.expire).toLocaleString() : 'Tidak diketahui';

    res.send(`<h1>✅ Login Berhasil</h1>
      <p>Email: ${payload.email}</p>
      <p>Nama: ${payload.name}</p>
      <p>Token kadaluarsa pada: ${expiredAt}</p>
      <img src="${payload.picture}" width="100"/>
      <p><a href="/start">Mulai Bersihkan Komentar</a></p>
      <p><a href="/blockedwords">Edit Daftar Kata Terlarang</a></p>`);
  } catch (err) {
    console.error('Gagal login:', err);
    res.status(500).send('Login gagal.');
  }
});

app.get('/blockedwords', (req, res) => {
  if (!fs.existsSync(BLOCKED_WORDS_PATH)) {
    fs.writeFileSync(BLOCKED_WORDS_PATH, JSON.stringify([], null, 2));
  }
  const words = JSON.parse(fs.readFileSync(BLOCKED_WORDS_PATH));
  res.send(`<h1>Daftar Kata Terlarang</h1>
    <form method="POST" action="/blockedwords">
      <textarea name="words" rows="10" cols="50">${words.join('\n')}</textarea><br>
      <button type="submit">Simpan</button>
    </form>
<p><a href="/start">Kembali ke Pembersihan</a></p>`);
});

app.post('/blockedwords', (req, res) => {
  const words = req.body.words
    .split('\n')
    .map(w => w.trim())
    .filter(w => w.length > 0);
  fs.writeFileSync(BLOCKED_WORDS_PATH, JSON.stringify(words, null, 2));
  res.redirect('/blockedwords');
});

function getJudolComment(text) {
  const normalizedText = text.normalize('NFKD');
  if (text !== normalizedText) return true;
  const blockedWords = JSON.parse(fs.readFileSync(BLOCKED_WORDS_PATH));
  const lowerText = text.toLowerCase();
  return blockedWords.some(word => lowerText.includes(word.toLowerCase()));
}

async function getSpamComments(youtube, videoId) {
  let comments = [];
  let nextPageToken = '';
  do {
    const res = await youtube.commentThreads.list({
      part: 'snippet',
      videoId,
      maxResults: 100,
      pageToken: nextPageToken
    });

    comments.push(
      ...res.data.items
        .filter(item => {
          const text = item.snippet.topLevelComment.snippet.textDisplay;
          return getJudolComment(text);
        })
        .map(item => item.snippet.topLevelComment.id)
    );
    nextPageToken = res.data.nextPageToken;
  } while (nextPageToken);
  return comments;
}

async function deleteComments(youtube, ids) {
  while (ids.length > 0) {
    const batch = ids.splice(0, 50);
    try {
      await youtube.comments.setModerationStatus({
        id: batch,
        moderationStatus: 'rejected'
      });
      console.log(`🧹 Berhasil hapus ${batch.length} komentar`);
    } catch (err) {
      console.error('Gagal hapus:', err.message);
    }
  }
}

app.listen(port, () => {
  console.log(`✅ Server aktif di http://localhost:${port}`);
  console.log(`🔐 Login: http://localhost:${port}/login`);
});