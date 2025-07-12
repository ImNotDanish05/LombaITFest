const Sessions = require('../models/Sessions');
const Users = require('../models/Users');

async function checkSession(req) {
  const session_id = req.cookies.session_id;
  const session_secret = req.cookies.session_secret;
  const user_agent = req.headers['user-agent'];
  console.log('Authenticating session...');
  console.log('Auth Session:', session_id);
  console.log('Session Secret:', session_secret);
  console.log('User Agent:', user_agent);
  if (!session_id || !session_secret) return null;

  const session = await Sessions.findOne({ session_id });
  if (
    !session ||
    session.session_secret !== session_secret ||
    session.user_agent !== user_agent ||
    session.expires_at < Date.now()
  ) {
    return null;
  }

  const user = await Users.findOne({ google_id: session.google_id });
  if (!user) return null;

  return user; // kalau valid, balikin user
}

async function authSession(req, res, next) {
  const session_id = req.cookies.session_id;
  const session_secret = req.cookies.session_secret;
  const user_agent = req.headers['user-agent'];
  console.log('Authenticating session...');
  console.log('Auth Session:', session_id);
  console.log('Session Secret:', session_secret);
  console.log('User Agent:', user_agent);
  if (!session_id || !session_secret) {
    return clearAndRedirect(res, '/login');
  }

  // Cari session di database
  const session = await Sessions.findOne({ session_id });

  if (
    !session ||
    session.session_secret !== session_secret ||
    session.user_agent !== user_agent ||
    session.expires_at < Date.now()
  ) {
    if (session && session.expires_at < Date.now()) {
      await Sessions.deleteOne({ session_id }); // hapus dari DB kalau expired
    }
    return clearAndRedirect(res, '/login');
  }

  // Cari user
  const user = await Users.findOne({ google_id: session.google_id });
  if (!user) {
    await Sessions.deleteOne({ session_id }); // hapus session orphan
    return clearAndRedirect(res, '/login');
  }

  req.user = user; // inject user ke req
  next();
}

// Fungsi bantu untuk hapus cookie & redirect
function clearAndRedirect(res, url) {
  res.clearCookie('session_id');
  res.clearCookie('session_secret');
  return res.redirect(url);
}

module.exports = {authSession, checkSession};