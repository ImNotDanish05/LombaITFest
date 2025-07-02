const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const LoadData = require('../../utils/LoadData');
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../../views'));

const TOKEN_PATH = path.join(__dirname, 'user_token.json');
const BLOCKED_WORDS_PATH = path.join(__dirname, 'blockedword.json');
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'openid',
  'email',
  'profile'
];
const YTdata = LoadData.loadYoutubeCredentials();
const client_id = YTdata.client_id;
const client_secret = YTdata.client_secret;
const redirect_uri = YTdata.redirect_uris[0] || process.env.REDIRECT_URI;

if (!client_id || !client_secret || !redirect_uri) {
  console.error('Pastikan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dan REDIRECT_URI sudah diatur di .env');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

// Simpan token baru jika diperbarui
oauth2Client.on('tokens', (tokens) => {
  if (tokens.refresh_token) {
    const updated = { ...tokens, created_at: new Date().toISOString() };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
  }
});

// Import fungsi deteksi judol
const { getJudolComment } = require('../comment_get_judol');

// Helper: ambil videoId dari url
function getVideoIdFromUrl(url) {
  if (!url) return null;
  const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/);
  return match ? match[1] : null;
}

// Login page
app.get('/login', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
  res.send(`
    <h1>Login Google</h1>
    <label>
      <input type="checkbox" id="agree" />
      Setuju dengan <a href="https://imnotdanish05.github.io/Terms-and-Conditions/app/YTJudolRemover/" target="_blank">Terms & Conditions</a>
    </label>
    <br><br>
    <button id="loginBtn" disabled>Login dengan Google</button>
    <script>
      const agree = document.getElementById('agree');
      const loginBtn = document.getElementById('loginBtn');
      agree.addEventListener('change', function() {
        loginBtn.disabled = !this.checked;
      });
      loginBtn.addEventListener('click', function() {
        if (agree.checked) window.location.href = "${url}";
      });
    </script>
  `);
});

// Google OAuth callback
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
    res.send(`<h1><span style="color:green;">&#x2705;</span> Login Berhasil</h1>
      <p>Email: ${payload.email}</p>
      <p>Nama: ${payload.name}</p>
      <p>Token kadaluarsa pada: ${expiredAt}</p>
      <img src="${payload.picture}" width="100"/>
      <p><a href="/start-form">Mulai Bersihkan Komentar</a></p>
      <p><a href="/blockedwords">Edit Daftar Kata Terlarang</a></p>`);
  } catch (err) {
    res.status(500).send(`<h1>Login gagal.</h1><pre>${err && (err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message || err.toString())}</pre>`);
  }
});

// Form input link YouTube
app.get('/start-form', (req, res) => {
  res.send(`
    <h1>Bersihkan Komentar Judol</h1>
    <form id="ytForm" method="POST" action="/start">
      <label for="videoUrl">Masukkan link YouTube:</label><br>
      <input type="url" id="videoUrl" name="videoUrl" style="width:350px;" required placeholder="https://www.youtube.com/watch?v=xxxx"><br><br>
      <button type="submit" id="startBtn" disabled>Mulai Bersihkan</button>
    </form>
    <script>
      const input = document.getElementById('videoUrl');
      const btn = document.getElementById('startBtn');
      input.addEventListener('input', function() {
        btn.disabled = !input.value.trim();
      });
    </script>
    <p><a href="/login">Kembali ke Login</a></p>
  `);
});

// Endpoint utama: proses komentar
app.post('/start', async (req, res) => {
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
    const videoUrl = req.body.videoUrl;
    if (!videoUrl) return res.status(400).send('Link YouTube belum diisi.');
    const videoId = getVideoIdFromUrl(videoUrl);
    if (!videoId) return res.status(400).send('Link video YouTube tidak valid.');
    const titleRes = await youtube.videos.list({ part: 'snippet', id: videoId });
    if (!titleRes.data.items.length) return res.status(404).send('Video tidak ditemukan atau tidak memiliki akses.');
    const title = titleRes.data.items[0].snippet.title;
    console.log(`📺 Mengecek video: ${title} (${videoId})`);

    // Ambil komentar dan deteksi judol
    let spamComments = [];
    let nextPageToken = '';
    do {
      const resComments = await youtube.commentThreads.list({
        part: 'snippet',
        videoId,
        maxResults: 100,
        pageToken: nextPageToken
      });
      resComments.data.items.forEach(item => {
        const text = item.snippet.topLevelComment.snippet.textOriginal;
        if (getJudolComment(text)) {
          spamComments.push({
            id: item.snippet.topLevelComment.id,
            text: item.snippet.topLevelComment.snippet.textDisplay,
            author: item.snippet.topLevelComment.snippet.authorDisplayName
          });
        }
      });
      nextPageToken = resComments.data.nextPageToken;
    } while (nextPageToken);

    if (spamComments.length === 0) {
      return res.send(`<h1>✅ Selesai</h1><p>Total komentar spam yang dihapus: <strong>0</strong></p>`);
    }
    res.render('index', { spamComments });
  } catch (err) {
    console.error('Error saat membersihkan:', err.response?.data || err.message || err);
    res.status(500).send('Terjadi kesalahan saat membersihkan komentar.');
  }
});

// Hapus komentar spam
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

    // Perbaikan: handle satu atau banyak id
    let ids = [];
    if (Array.isArray(req.body.ids)) {
      ids = req.body.ids;
    } else if (typeof req.body.ids === 'string') {
      ids = [req.body.ids];
    }

    if (ids.length === 0) {
      return res.send(`<h1>✅ Selesai</h1><p>Total komentar spam yang dihapus: <strong>0</strong></p><p><i>Tidak ada ID komentar yang dikirim.</i></p>`);
    }
    await deleteComments(youtube, ids);
    res.send(`<h1>✅ Selesai</h1><p>Total komentar spam yang dihapus: <strong>${ids.length}</strong></p>`);
  } catch (err) {
    res.status(500).send(`<h1>Gagal menghapus komentar.</h1><pre>${err && (err.response?.data ? JSON.stringify(err.response.data, null, 2) : err.message || err.toString())}</pre>`);
  }
});

// Fungsi hapus komentar
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
      throw err;
    }
  }
}

// Tampilkan dan edit daftar kata terlarang
app.get('/blockedwords', (req, res) => {
  if (!fs.existsSync(BLOCKED_WORDS_PATH)) {
    fs.writeFileSync(BLOCKED_WORDS_PATH, JSON.stringify([], null, 2));
  }
  const words = JSON.parse(fs.readFileSync(BLOCKED_WORDS_PATH));
  res.send(`
    <h1>Daftar Kata Terlarang</h1>
    <form method="POST" action="/blockedwords">
      <textarea name="words" rows="10" cols="50">${words.join('\n')}</textarea><br>
      <button type="submit">Simpan</button>
    </form>
    <p><a href="/start-form">Kembali ke Bersihkan Komentar</a></p>
  `);
});

app.post('/blockedwords', (req, res) => {
  const words = req.body.words
    .split('\n')
    .map(w => w.trim())
    .filter(w => w.length > 0);
  fs.writeFileSync(BLOCKED_WORDS_PATH, JSON.stringify(words, null, 2));
  res.redirect('/blockedwords');
});

app.listen(port, () => {
  console.log(`✅ Server aktif di http://localhost:${port}`);
  console.log(`🔐 Login: http://localhost:${port}/login`);
});

module.exports = app;