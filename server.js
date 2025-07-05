require('dotenv').config({ path: './backend/config/.env' }); // Pastikan path ke .env benar
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { google } = require('googleapis');
const { getJudolComment, getJudolCommentAi } = require('./controllers/comment_get_judol');
const Users = require('./models/Users');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: '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', // ganti dengan secret yang aman
  resave: false,
  saveUninitialized: true
}));

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

// sessions
const sessionsRoutes = require('./routes/sessions');
app.use('/api/sessions', sessionsRoutes);

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

//route home
app.get('/home', (req, res) => {
  res.render('pages/home');
});

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
    // Set cookie user_id untuk auto-login
    res.cookie('user_id', user._id, { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true });
    res.redirect('/dashboard/' + user._id); // atau ke route dashboard yang sesuai
  } catch (error) {
    console.error('Error during OAuth callback:', error);
    res.status(500).send('Terjadi kesalahan saat otentikasi.');
  }
});

// Dashboard dengan id (akses setelah login)
app.get('/dashboard/:id', async (req, res) => {
  try {
    let userId = req.params.id;
    if (!userId && req.cookies.user_id) {
      userId = req.cookies.user_id;
    }
    if (!userId) return res.redirect('/');
    const user = await Users.findById(userId).lean();
    if (!user) return res.redirect('/');
    res.render('pages/dashboard', {
      user: {
        name: user.username,
        email: user.email,
        picture: user.picture
      }
    });
  } catch (error) {
    res.status(500).send('Gagal mengambil data user.');
  }
});

// Dashboard tanpa id (akses otomatis via cookie)
app.get('/dashboard', async (req, res) => {
  const userId = req.cookies.user_id;
  if (!userId) return res.redirect('/');
  const user = await Users.findById(userId).lean();
  if (!user) {
    res.clearCookie('user_id');
    return res.redirect('/');
  }
  res.render('pages/dashboard', {
    user: {
      name: user.username,
      email: user.email,
      picture: user.picture
    }
  });
});

// --- HAPUS AKUN: Hapus user dari DB dan hapus cookie ---
app.get('/delete-account', async (req, res) => {
  try {
    const userId = req.cookies.user_id;
    if (userId) {
      await Users.findByIdAndDelete(userId);
      res.clearCookie('user_id');
    }
    res.redirect('/'); // Atau ke halaman login
  } catch (err) {
    res.status(500).send('Gagal menghapus akun.');
  }
});

// Route POST get-comments
app.post('/get-comments', async (req, res) => {
  try {
    const youtubeUrl = req.body.youtubeUrl;
    const match = youtubeUrl.match(/(?:v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
    if (!match) return res.status(400).send('Link YouTube tidak valid.');
    const videoId = match[1];

    // Pastikan oauth2Client sudah set credentials user yang login!
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const response = await youtube.commentThreads.list({
      part: 'snippet',
      videoId,
      maxResults: 20
    });

    // Simpan commentId juga!
    const comments = response.data.items.map(item => ({
      text: item.snippet.topLevelComment.snippet.textDisplay,
      commentId: item.snippet.topLevelComment.id
    }));

    // Deteksi spam manual & AI
    const manualResults = comments.map(c => getJudolComment(c.text));
    const notDetectedManually = comments.filter((c, i) => !manualResults[i]).map(c => c.text);
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

    // Ambil data user dari database
    const user = await Users.findOne();

    // Gabungkan spam ke komentar
    const commentsWithSpam = comments.map((c, i) => ({
      ...c,
      isSpam: spamResults[i]
    }));

    res.render('pages/dashboard', {
      user: {
        name: user.username,
        email: user.email,
        picture: user.picture
      },
      comments: commentsWithSpam
    });
  } catch (err) {
    console.error('YouTube API error:', err);
    res.status(500).send('Gagal mengambil komentar.');
  }
});

// Route POST delete-comments
app.post('/delete-comments', async (req, res) => {
  let selectedIds = req.body.commentId;
  if (!selectedIds) return res.redirect('back');
  if (typeof selectedIds === 'string') selectedIds = [selectedIds];

  // Pastikan oauth2Client sudah set credentials user yang login!
  try {
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    for (const id of selectedIds) {
      await youtube.comments.delete({ id });
    }
    // Setelah hapus, redirect ke dashboard (atau tampilkan pesan sukses)
    res.redirect('back');
  } catch (err) {
    console.error('Gagal menghapus komentar:', err);
    res.status(500).send('Gagal menghapus komentar.');
  }
});

app.get('/', async (req, res) => {
  let isLoggedIn = false;
  if (req.cookies.user_id) {
    const user = await Users.findById(req.cookies.user_id).lean();
    if (user) {
      isLoggedIn = true;
    } else {
      res.clearCookie('user_id');
    }
  }
  res.render('pages/home', { isLoggedIn });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`✅ Server aktif di http://localhost:${process.env.PORT || 3000}`);
  console.log(`🔐 Login: http://localhost:${process.env.PORT || 3000}/login`);
});