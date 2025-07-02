const express = require('express');
const router = express.Router();
const youtubeController = require('../controllers/youtubeController');
const bodyParser = require('body-parser');

// Parse URL-encoded bodies (as sent by HTML forms)
router.use(bodyParser.urlencoded({ extended: true }));

// Parse JSON bodies (as sent by API clients)
router.use(bodyParser.json());

// Tampilkan form input link YouTube
router.get('/start-form', youtubeController.showStartForm);

// Proses pencarian komentar spam
router.post('/start', youtubeController.processComments);

// Hapus komentar terpilih
router.post('/delete-spam', youtubeController.deleteComments);

module.exports = router;