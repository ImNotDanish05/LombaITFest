const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const crypto = require('crypto');
const { checkSession } = require('../controllers/authSession');
const Users = require('../models/Users');
const Sessions = require('../models/Sessions');
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
  'openid', 'email', 'profile'
];

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
  const code = req.query.code;
  if (!code) return res.status(400).send('Kode otorisasi tidak ditemukan.');
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userinfo = await oauth2.userinfo.get();

    const user = await Users.findOneAndUpdate(
      { google_id: userinfo.data.id },
      {
        google_id: userinfo.data.id,
        email: userinfo.data.email,
        username: userinfo.data.name,
        picture: userinfo.data.picture,
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

    const session_id = crypto.randomBytes(32).toString('hex');
    const session_secret = crypto.randomBytes(32).toString('hex');
    const user_agent = req.headers['user-agent'] || 'unknown';

    await Sessions.findOneAndUpdate(
      { google_id: userinfo.data.id },
      {
        google_id: userinfo.data.id,
        session_id,
        session_secret,
        user_agent,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      },
      { upsert: true, new: true }
    );

    const secureCookie = isProductionHttps();
    res.cookie('session_id', session_id, {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: secureCookie
    });
    res.cookie('session_secret', session_secret, {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: secureCookie
    });

    res.redirect('/dashboard/');
  } catch (error) {
    console.error('Error during OAuth callback:', error);
    res.status(500).send('Terjadi kesalahan saat otentikasi.');
  }
});

router.get('/delete-account', require('../controllers/authSession').authSession, async (req, res) => {
  try {
    const userId = req.user.user_id;
    if (userId) {
      await Users.findOneAndDelete({ user_id: userId });
      await Sessions.findOneAndDelete({ session_id: req.cookies.session_id });
      res.clearCookie('session_id');
      res.clearCookie('session_secret');
    }
    res.sendStatus(200);
  } catch (err) {
    res.status(500).send(err);
  }
});

module.exports = router;
