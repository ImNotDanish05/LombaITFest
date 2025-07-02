require('dotenv').config({ path: './backend/config/.env' }); // Pastikan path ke .env benar
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { google } = require('googleapis');
const app = express();
const { getJudolComment, getJudolCommentAi } = require('./controllers/comment_get_judol');
const Users = require('./models/Users'); // pastikan sudah di-import

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // <-- Tambahkan baris ini!
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

mongoose.connect('mongodb+srv://syauqi:RU5Jch8oORT91cnL@youtubedata.cqgmi5j.mongodb.net/dbKontenJudol')
.then(() => console.log('MongoDB Atlas connected'))
.catch((err) => console.error('Connection error:', err));

// channel
const channelRoutes = require('./routes/channels');
app.use('/api/channel', channelRoutes);

// comments
const commentsRoutes = require('./routes/comments');
app.use('/api/comments', commentsRoutes);

// logs
const logsRoutes = require('./routes/logs');
app.use('/api/logs', logsRoutes);

// user
const usersRoutes = require('./routes/users');
app.use('/api/users', usersRoutes);

// videos
const videosRoutes = require('./routes/videos');
app.use('/api/videos', videosRoutes);

// youtube
const youtubeRoutes = require('./routes/youtube');
app.use('/', youtubeRoutes);

// index page
const indexRoute = require('./routes/index');
app.use('/', indexRoute);

// Debug: cek apakah env terbaca
console.log('CLIENT_ID:', process.env.GOOGLE_CLIENT_ID);
console.log('CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET);
console.log('REDIRECT_URI:', process.env.REDIRECT_URI);

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'openid',
  'email',
  'profile'
];

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Endpoint login
app.get('/login', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
  res.render('pages/login', { googleLoginUrl: url });
});

app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Kode otorisasi tidak ditemukan.');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Ambil info user dari Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userinfo = await oauth2.userinfo.get();

    // Simpan/update ke MongoDB
    const user = await Users.findOneAndUpdate(
      { google_id: userinfo.data.id },
      {
        google_id: userinfo.data.id,
        email: userinfo.data.email,
        username: userinfo.data.name,
        picture: userinfo.data.picture, // <-- Tambahkan baris ini!
        role: 'user',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry: new Date(tokens.expiry_date),
        scope: Array.isArray(tokens.scope) ? tokens.scope : (tokens.scope ? tokens.scope.split(' ') : []),
        token_type: tokens.token_type,
        user_id: userinfo.data.id,
        created_at: new Date()
      },
      { upsert: true, new: true }
    );

    // Redirect ke dashboard dengan id user
    res.redirect(`/dashboard/${user._id}`);
  } catch (error) {
    console.error('Error during OAuth callback:', error);
    res.status(500).send('Terjadi kesalahan saat otentikasi.');
  }
});

app.get('/dashboard/:id', async (req, res) => {
  try {
    const user = await Users.findById(req.params.id).lean();
    if (!user) return res.status(404).send('User tidak ditemukan.');

    res.render('pages/dashboard', {
      user: {
        name: user.username,
        email: user.email,
        picture: user.picture // jika ingin simpan url foto profil, tambahkan field picture di model dan simpan saat login
      }
    });
  } catch (error) {
    res.status(500).send('Gagal mengambil data user.');
  }
});

app.post('/get-comments', async (req, res) => {
  console.log('req.body:', req.body); // Debug
  const youtubeUrl = req.body.youtubeUrl;
  const match = youtubeUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (!match) return res.status(400).send('Link YouTube tidak valid.');
  const videoId = match[1];
  console.log('videoId:', videoId);

  try {
    const { google } = require('googleapis');
    const youtube = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
    const response = await youtube.commentThreads.list({
      part: 'snippet',
      videoId,
      maxResults: 20
    });
    console.log('YouTube API response:', response.data);

    const comments = response.data.items.map(item => item.snippet.topLevelComment.snippet.textDisplay);

    // Deteksi spam manual & AI
    const manualResults = comments.map(getJudolComment);
    const notDetectedManually = comments.filter((c, i) => !manualResults[i]);
    let aiResults = [];
    if (notDetectedManually.length > 0) {
      aiResults = await getJudolCommentAi(notDetectedManually);
    }

    // Gabungkan hasil manual & AI
    let spamResults = [];
    let aiIdx = 0;
    for (let i = 0; i < comments.length; i++) {
      if (manualResults[i]) {
        spamResults.push(1);
      } else {
        spamResults.push(aiResults[aiIdx++] || 0);
      }
    }

    // Ambil data user dari database (misal dari session, atau ambil user pertama untuk demo)
    const user = await Users.findOne(); // Ganti dengan user yang sesuai jika pakai session

    // Render dashboard dengan daftar komentar
    res.render('pages/dashboard', {
      user: {
        name: user.username,
        email: user.email,
        picture: user.picture
      },
      comments: comments.map((text, i) => ({
        text,
        isSpam: spamResults[i]
      }))
    });
  } catch (err) {
    console.error('YouTube API error:', err);
    res.status(500).send('Gagal mengambil komentar.');
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`✅ Server aktif di http://localhost:${process.env.PORT || 3000}`);
  console.log(`🔐 Login: http://localhost:${process.env.PORT || 3000}/login`);
});