const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { google } = require('googleapis');
require('dotenv').config();

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

// ===== Tambahkan endpoint /login di sini =====
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

app.get('/login', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
  res.render('pages/login', { googleLoginUrl: url });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`✅ Server aktif di http://localhost:${process.env.PORT || 3000}`);
  console.log(`🔐 Login: http://localhost:${process.env.PORT || 3000}/login`);
});