const express = require('express');
const router = express.Router();
const Users = require('../models/Users');
const { authSession } = require('../controllers/authSession');
const isProductionHttps = require('../utils/isProductionHttps');

router.get('/judolremover', authSession, async (req, res) => {
  const userId = req.user;
  const isHttps = isProductionHttps() ? "1" : "0";
  console.log(`isProductionHttps: ${isHttps}`);
  if (!userId) return res.redirect('/');
  const user = await Users.findById(userId).lean();
  if (!user) {
    res.clearCookie('session_id');
    res.clearCookie('session_secret');
    return res.redirect('/');
  }
  res.render('pages/judolremover', {
    user: {
      name: user.username,
      email: user.email,
      picture: user.picture
    },
    isProductionHttps: isHttps
  });
});

module.exports = router;
