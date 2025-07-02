require('dotenv').config({ path: './backend/config/.env' }); // Pastikan path ke .env benar
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { google } = require('googleapis');
const app = express();

app.use(cors());
app.use(bodyParser.json());
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

    // Ambil info user
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userinfo = await oauth2.userinfo.get();
      res.render('D:\lomba software CodeNova\LombaITFest\controllers\youtube\index.js', {
        user: userinfo.data,
        tokens : tokens
      });
    } catch (error) {
      console.error('Error during OAuth callback:', error);
      res.status(500).send('Terjadi kesalahan saat otentikasi.');
    }
  });

app.listen(process.env.PORT || 3000, () => {
  console.log(`✅ Server aktif di http://localhost:${process.env.PORT || 3000}`);
  console.log(`🔐 Login: http://localhost:${process.env.PORT || 3000}/login`);
});