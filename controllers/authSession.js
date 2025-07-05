const Sessions = require('../models/Sessions');
const Users = require('../models/Users');

async function authSession(req, res, next) {
  const session_id = req.cookies.session_id;
  if (!session_id) return res.redirect('/login');

  const session = await Sessions.findOne({ session_id });
  if (!session || session.expires_at < Date.now()) return res.redirect('/login');

  const user = await Users.findOne({ google_id: session.google_id });
  if (!user) return res.redirect('/login');

  req.user = user; // inject user ke req
  next();
}

module.exports = authSession;