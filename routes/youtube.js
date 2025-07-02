const express = require('express');
const router = express.Router();
const youtubeController = require('../controllers/youtubeController');

// Tampilkan form input link YouTube
router.get('/start-form', youtubeController.showStartForm);

// Proses pencarian komentar spam
router.post('/start', youtubeController.processComments);

// Hapus komentar terpilih
router.post('/delete-spam', youtubeController.deleteComments);

module.exports = router;