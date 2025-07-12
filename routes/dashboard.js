const express = require('express');
const router = express.Router();
const Users = require('../models/Users');
const { authSession } = require('../controllers/authSession');

router.get('/dashboard', authSession, async (req, res) => {
  const userId = req.user;
  if (!userId) return res.redirect('/');
  const user = await Users.findById(userId).lean();
  if (!user) {
    res.clearCookie('session_id');
    res.clearCookie('session_secret');
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

module.exports = router;
