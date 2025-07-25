const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const LoadData = require('../../utils/LoadData');
const { getJudolComment } = require('../comment_get_judol');
const isProductionHttps = require('../../utils/isProductionHttps');

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
const redirect_uri = isProductionHttps() ? YTdata.redirect_uris[1] : YTdata.redirect_uris[0];

if (!client_id || !client_secret || !redirect_uri) {
  console.error('Pastikan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, dan REDIRECT_URI sudah diatur di .env');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

oauth2Client.on('tokens', (tokens) => {
  if (tokens.refresh_token) {
    const updated = { ...tokens, created_at: new Date().toISOString() };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
  }
});

function getVideoIdFromUrl(url) {
  if (!url) return null;
  const pattern = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=|embed\/|shorts\/)?([a-zA-Z0-9_-]{11})/;
  const match = url.match(pattern);
  return match ? match[1] : null;
}

module.exports = {
  oauth2Client,
  getVideoIdFromUrl,
  getJudolComment,
  TOKEN_PATH,
  BLOCKED_WORDS_PATH,
  SCOPES,
  client_id
};
