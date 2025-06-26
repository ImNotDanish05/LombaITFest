const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const TOKEN_PATH = path.join(__dirname, 'user_token.json');
const BLOCKED_WORDS_PATH = path.join(__dirname, 'blockedword.json');
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'openid',
  'email',
  'profile'
];

const client_id = process.env.GOOGLE_CLIENT_ID;
const client_secret = process.env.GOOGLE_CLIENT_SECRET;
const redirect_uri = process.env.REDIRECT_URI;

if (!client_id || !client_secret || !redirect_uri) {
  console.error('Pastikan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dan REDIRECT_URI sudah diatur di .env');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  client_id,
  client_secret,
  redirect_uri
);

// Simpan token baru jika diperbarui
oauth2Client.on('tokens', (tokens) => {
  if (tokens.refresh_token) {
    const updated = {
      ...tokens,
      created_at: new Date().toISOString()
    };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
  }
});

function getVideoIdFromUrl(url) {
  if (!url) return null;
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
    const videoUrl = process.env.YOUTUBE_VIDEO_URL;

    if (!videoUrl) {
      return res.status(400).send('YOUTUBE_VIDEO_URL tidak ditemukan di .env');
    }

    const videoId = getVideoIdFromUrl(videoUrl);
    if (!videoId) {
      return res.status(400).send('Link video YouTube tidak valid di .env');
    }

    const titleRes = await youtube.videos.list({
      part: 'snippet',
      id: videoId
    });

    if (!titleRes.data.items.length) {
      return res.status(404).send('Video tidak ditemukan atau tidak memiliki akses.');
    }

    const title = titleRes.data.items[0].snippet.title;

    console.log(`📺 Mengecek video: ${title} (${videoId})`);

    // Ambil komentar spam beserta teksnya
    let spamComments = [];
    let nextPageToken = '';
    do {
      const resComments = await youtube.commentThreads.list({
        part: 'snippet',
        videoId,
        maxResults: 100,
        pageToken: nextPageToken
      });

      spamComments.push(
        ...resComments.data.items
          .filter(item => {
            const text = item.snippet.topLevelComment.snippet.textOriginal;
            return getJudolComment(text);
          })
          .map(item => ({
            id: item.snippet.topLevelComment.id,
            text: item.snippet.topLevelComment.snippet.textDisplay,
            author: item.snippet.topLevelComment.snippet.authorDisplayName
          }))
      );
      nextPageToken = resComments.data.nextPageToken;
    } while (nextPageToken);

    if (spamComments.length === 0) {
      return res.send(`<h1>✅ Selesai</h1><p>Total komentar spam yang dihapus: <strong>0</strong></p>`);
    }

    // Tampilkan daftar komentar spam dan tombol hapus
    let listHtml = spamComments.map(c =>
      `<li><b>${c.author}:</b> ${c.text}</li>`
    ).join('');
    res.send(`
      <h1>🚨 Ditemukan ${spamComments.length} komentar spam</h1>
      <ul>${listHtml}</ul>
      <form method="POST" action="/delete-spam">
        <input type="hidden" name="ids" value="${spamComments.map(c => c.id).join(',')}">
        <button type="submit">Hapus Semua Komentar Spam Ini</button>
      </form>
    `);
  } catch (err) {
    console.error('Error saat membersihkan:', err.response?.data || err.message || err);
    res.status(500).send('Terjadi kesalahan saat membersihkan komentar.');
  }
});

// Endpoint untuk menghapus komentar spam
app.post('/delete-spam', express.urlencoded({ extended: true }), async (req, res) => {
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
    const ids = req.body.ids ? req.body.ids.split(',').filter(Boolean) : [];
    if (ids.length === 0) {
      return res.send(`<h1>✅ Selesai</h1><p>Total komentar spam yang dihapus: <strong>0</strong></p><p><i>Tidak ada ID komentar yang dikirim.</i></p>`);
    }
    await deleteComments(youtube, ids);
    res.send(`<h1>✅ Selesai</h1><p>Total komentar spam yang dihapus: <strong>${ids.length}</strong></p>`);
  } catch (err) {
    res.status(500).send(`<h1>Gagal menghapus komentar.</h1><pre>${err && (err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message || err.toString())}</pre>`);
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
    // Tampilkan error detail di browser
    res.status(500).send(`<h1>Login gagal.</h1><pre>${err && (err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message || err.toString())}</pre>`);
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
          const text = item.snippet.topLevelComment.snippet.textOriginal;
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
      console.error('Gagal hapus:', err.message, err.response?.data);
      throw err; // <-- Tambahkan ini agar error dilempar ke catch di atas
    }
  }
}

app.listen(port, () => {
  console.log(`✅ Server aktif di http://localhost:${port}`);
  console.log(`🔐 Login: http://localhost:${port}/login`);
});
