const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const fs = require('fs');
const crypto = require('crypto');
const Users = require('../models/Users');
const Sessions = require('../models/Sessions');
const { getVideoIdFromUrl } = require('../controllers/youtube/index');
const { getJudolComment, getJudolCommentAi } = require('../controllers/comment_get_judol');
const { authSession, checkSession } = require('../controllers/authSession');
const isProductionHttps = require('../utils/isProductionHttps');
const { loadYoutubeCredentials } = require('../utils/LoadData');

const YC = loadYoutubeCredentials();
const oauth2Client = new google.auth.OAuth2(
  YC.client_id,
  YC.client_secret,
  isProductionHttps() ? YC.redirect_uris[1] : YC.redirect_uris[0]
);

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'openid',
  'email',
  'profile'
];

// --- Semua route GET dan POST dari server.js dipindah ke sini ---
router.get('/login', async (req, res) => {
  const user = await checkSession(req);
  if (user) return res.redirect('/dashboard/');
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    redirect_uri: isProductionHttps() ? YC.redirect_uris[1] : YC.redirect_uris[0]
  });
  res.render('pages/login', { googleLoginUrl: url });
});

router.get('/auth/callback', async (req, res) => {
  // callback login
  // (copy isi dari server.js di bagian ini ke sini)
});

// ... router.get('/dashboard'), router.post('/get-comments'), router.post('/delete-comments'), dll

router.get('/', async (req, res) => {
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

module.exports = router;
