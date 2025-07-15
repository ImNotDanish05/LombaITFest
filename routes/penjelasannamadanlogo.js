const express = require('express');
const router = express.Router();
const { authSession } = require('../controllers/authSession');

router.get('/penjelasannamadanlogo', authSession, (req, res) => {
  res.render('pages/penjelasannamadanlogo', { user: req.user });
});

module.exports = router;
