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

// === Import fungsi manual dan AI ===
const { getJudolComment } = require('../controllers/comment_get_judol');
const { classifyComments } = require('../controllers/test_ai');

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

    // Ambil komentar
    let spamComments = [];
    let notJudolComments = [];
    let notJudolRaw = [];
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
        const isJudol = getJudolComment(text);
        if (isJudol) {
          spamComments.push({
            id: item.snippet.topLevelComment.id,
            text: item.snippet.topLevelComment.snippet.textDisplay,
            author: item.snippet.topLevelComment.snippet.authorDisplayName
          });
        } else {
          notJudolComments.push({
            id: item.snippet.topLevelComment.id,
            text: item.snippet.topLevelComment.snippet.textDisplay,
            author: item.snippet.topLevelComment.snippet.authorDisplayName
          });
          notJudolRaw.push(text);
        }
      });
      nextPageToken = resComments.data.nextPageToken;
    } while (nextPageToken);

    // Analisis AI untuk komentar yang tidak terdeteksi manual
    let aiSpamIds = [];
    if (notJudolRaw.length > 0) {
      const aiResults = await classifyComments(notJudolRaw);
      notJudolComments.forEach((item, idx) => {
        const aiResult = aiResults[idx];
        if (
          aiResult === true ||
          aiResult === 'true' ||
          aiResult === 1 ||
          aiResult === '1'
        ) {
          spamComments.push(item);
          aiSpamIds.push(item.id);
        }
      });
    }

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

// === Checkbox Terms & Conditions di halaman login ===
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
      Setuju dengan <a href="/terms" target="_blank">Terms & Conditions</a>
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
        if (agree.checked) {
          window.location.href = "${url}";
        }
      });
    </script>
  `);
});

// (opsional) Terms & Conditions page
app.get('/terms', (req, res) => {
  res.send(`
    <h1><em>Terms and Conditions – YTJudolRemover</em></h1>
    <p><strong>Last Updated: 26 June 2025</strong></p>
    <p>Please read these Terms and Conditions ("Terms", "Terms and Conditions") carefully before using <em>YTJudolRemover</em> (“the Service”) operated by the <em>CodeNova Team</em> ("we", "our", or "us"). Your access to and use of the Service is conditioned on your acceptance of and compliance with these Terms. If you do not agree with any part of the terms, you may not access the Service.</p>
    <hr>
    <h2><em>1. Acceptance of Terms</em></h2>
    <p>By accessing or using <em>YTJudolRemover</em>, you agree to be bound by these Terms and all applicable laws and regulations. Your use of the Service constitutes your acknowledgment that you have read, understood, and agreed to be legally bound by these Terms. Continued use of the Service following any updates or changes to these Terms will constitute your acceptance of those changes.</p>
    <hr>
    <h2><em>2. Use of Service</em></h2>
    <p><em>YTJudolRemover</em> is developed by the CodeNova Team to detect and manage “judol” comments (provocative, misleading, or irrelevant content) on YouTube videos.</p>
    <p>Users may input a YouTube video link—either their own or someone else’s—to analyze the comment section.</p>
    <ul>
      <li>If the video belongs to the user, the Service may offer options to hide or manage disruptive comments.</li>
      <li>If the video does not belong to the user, the Service allows the user to report such comments as spam.</li>
    </ul>
    <p>Users may manually review, approve, or ignore detected comments, giving them full control and flexibility.</p>
    <p>The application is strictly limited to this purpose. We do not and will not use the collected data for any unrelated, unauthorized, or malicious activities.</p>
    <hr>
    <h2><em>3. Data Collection & Use</em></h2>
    <p><em>YTJudolRemover</em> utilizes the YouTube Data API v3 to authenticate users and access their YouTube account data for the sole purpose of enabling comment analysis and moderation features.</p>
    <p>Only the minimal necessary data is accessed to perform the following:</p>
    <ul>
      <li>Authenticate the user via OAuth</li>
      <li>Retrieve video and comment data for moderation</li>
    </ul>
    <p>No personal data is permanently stored, shared, or sold. CodeNova Team guarantees responsible use of user data and does not engage in any misuse or unethical manipulation of account information.</p>
    <hr>
    <h2><em>4. Limitations of Liability</em></h2>
    <p>While CodeNova Team makes every effort to secure and protect user data, we are not liable for any unauthorized access, data loss, or exposure resulting from circumstances beyond our control, such as:</p>
    <ul>
      <li>Platform vulnerabilities</li>
      <li>Third-party attacks</li>
      <li>User negligence in managing personal account access</li>
    </ul>
    <p>Users are fully responsible for maintaining the security of their Google account credentials.<br>
    We do not take responsibility for the exposure of user data unless proven to be caused by direct abuse or negligence from our system.</p>
    <hr>
    <h2><em>5. Modifications to These Terms</em></h2>
    <p>We reserve the right to update or revise these Terms at any time. Substantial changes will be communicated via appropriate means. Continued use of <em>YTJudolRemover</em> after modifications indicates acceptance of the updated Terms.</p>
    <hr>
    <h2><em>6. Contact Information</em></h2>
    <p>If you have any questions or concerns regarding these Terms and Conditions, please reach out to us via:</p>
    <p>📧 <em><a href="mailto:imnotdanish05bussiness@gmail.com">imnotdanish05bussiness@gmail.com</a></em></p>
    <hr>
    <p><a href="/login">Kembali ke Login</a></p>
  `);
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

app.listen(port, () => {
  console.log(`✅ Server aktif di http://localhost:${port}`);
  console.log(`🔐 Login: http://localhost:${port}/login`);
});
