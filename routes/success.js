const express = require('express');
const router = express.Router();
const { authSession } = require('../controllers/authSession');
const { loadYoutubeCredentials } = require('../utils/LoadData');
const { google } = require('googleapis');
const isProductionHttps = require('../utils/isProductionHttps');

const credentials = loadYoutubeCredentials();
const oauth2Client = new google.auth.OAuth2(
  credentials.client_id,
  credentials.client_secret,
  isProductionHttps() ? credentials.redirect_uris[1] : credentials.redirect_uris[0]
);


router.post('/delete-comments', authSession, async (req, res) => {
  let selectedIds = req.body.ids;
  const user = req.user;
  console.log('Selected IDs:', selectedIds);
  if (!selectedIds) return res.redirect('back');
  if (typeof selectedIds === 'string') selectedIds = [selectedIds];

  const isOwner = req.body.isOwner === '1';
  const permanentDelete = req.body.permanentDelete === '1';

  try {
    // Set credentials lengkap
    oauth2Client.setCredentials({
      access_token: req.user.access_token,
      refresh_token: req.user.refresh_token,
      token_type: req.user.token_type
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    for (const id of selectedIds) {
      if (isOwner) {
        if (permanentDelete) {
          // Hapus permanen
          console.log(`Menghapus komentar ID: ${id} secara permanen...`);
          await youtube.comments.delete({ id });
        } else {
          // Hide (bisa di-undo)
          console.log(`Menandai komentar ID: ${id} sebagai tidak pantas...`);
          await youtube.comments.setModerationStatus({
            id,
            moderationStatus: 'rejected'
          });
        }
      } else {
        // Jika bukan pemilik, hanya bisa tandai sebagai spam
        await youtube.comments.markAsSpam({ id });
      }
    }

    // Render halaman sukses
    res.render('pages/success', {
      message: 'Komentar berhasil diproses.',
      isOwner,
      permanentDelete,
      selectedIds: selectedIds.length,
      user:user
    });
  } catch (err) {
    console.error('Gagal memproses komentar:', err);
    res.status(500).send('Gagal memproses komentar.');
}
});

module.exports = router;