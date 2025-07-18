const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const crypto = require('crypto');
const { checkSession, authSession } = require('../controllers/authSession');
const Users = require('../models/Users');
const Sessions = require('../models/Sessions');
const isProductionHttps = require('../utils/isProductionHttps');
const { loadYoutubeCredentials } = require('../utils/LoadData');
const downloadImage = require('../utils/downloadImage');


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

// ======================
// Login Page
// ======================
router.get('/login', async (req, res) => {
  try {
    const user = await checkSession(req);
    if (user) return res.redirect('/dashboard/');

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      redirect_uri: isProductionHttps() ? YC.redirect_uris[1] : YC.redirect_uris[0]
    });

    res.render('pages/login', { googleLoginUrl: url });
  } catch (err) {
    console.error('Login Page Error:', err);
    res.status(500).send('Terjadi kesalahan saat membuka halaman login.');
  }
});

// ======================
// Logout
// ======================
router.get('/logout', async (req, res) => {
  try {
    const session_id = req.cookies.session_id;
    if (session_id) {
      await Sessions.findOneAndDelete({ session_id }); // hapus sesi di DB
    }

    // Hapus cookie di browser
    res.clearCookie('session_id');
    res.clearCookie('session_secret');

    // Redirect ke halaman login
    res.redirect('/login');
  } catch (err) {
    console.error('Error saat logout:', err);
    res.status(500).send('Terjadi kesalahan saat logout.');
  }
});


// ======================
// OAuth Callback
// ======================
router.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Kode otorisasi tidak ditemukan.');

  try {
    // 1. Ambil token dari Google
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // 2. Ambil informasi user
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userinfo } = await oauth2.userinfo.get();
    
    //download gambar profil
    const filename = `${userinfo.id}_profile.jpg`;
    const localPath = await downloadImage(userinfo.picture, filename);
    userinfo.picture = localPath; // update picture dengan path lokal
    
    // 3. Simpan atau update user di database
    const user = await Users.findOneAndUpdate(
      { google_id: userinfo.id },
      {
        google_id: userinfo.id,
        email: userinfo.email,
        username: userinfo.name,
        picture: userinfo.picture,
        local_picture: localPath, // Simpan nama file lokal
        role: 'user',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry: new Date(tokens.expiry_date),
        scope: Array.isArray(tokens.scope) ? tokens.scope : (tokens.scope ? tokens.scope.split(' ') : []),
        token_type: tokens.token_type,
        user_id: userinfo.id,
        created_at: new Date()
      },
      { upsert: true, new: true }
    );

    // 4. Buat session baru
    const session_id = crypto.randomBytes(32).toString('hex');
    const session_secret = crypto.randomBytes(32).toString('hex');
    const user_agent = req.headers['user-agent'] || 'unknown';

    await Sessions.findOneAndUpdate(
      { google_id: userinfo.id },
      {
        google_id: userinfo.id,
        session_id,
        session_secret,
        user_agent,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 hari
      },
      { upsert: true, new: true }
    );

    // 5. Set cookie
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

// ======================
// Profile Page
// ======================
router.get('/profile', authSession, async (req, res) => {
  try {
    const user = req.user; // dari middleware authSession
    res.render('pages/profile', { user });
  } catch (err) {
    console.error('Error saat membuka halaman profile:', err);
    res.status(500).send('Gagal memuat halaman profile.');
  }
});


// ======================
// Delete Account
// ======================
router.get('/delete-account', authSession, async (req, res) => {
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
    console.error('Error saat hapus akun:', err);
    res.status(500).send('Terjadi kesalahan saat menghapus akun.');
  }
});

module.exports = router;
