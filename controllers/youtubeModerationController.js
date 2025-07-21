const { google } = require('googleapis');
const getUserTokens = require('../utils/getUserTokens');

// exports.moderateComments = async (req, res) => {
//   try {
//     const { ids, action, videoId } = req.body;

//     // Jika tidak ada komentar terpilih
//     if (!ids || ids.length === 0) {
//       return res.redirect(`/komentar_spam?videoId=${videoId}`);
//     }

//     const token = await getUserTokens(req); // ambil token OAuth user
//     if (!token) {
//       return res.redirect('/login'); // jika belum login
//     }

//     const youtube = google.youtube({
//       version: 'v3',
//       auth: token
//     });

//     // Pastikan ids array
//     const commentIds = Array.isArray(ids) ? ids : [ids];

//     for (const commentId of commentIds) {
//       if (action === 'delete') {
//         await youtube.comments.delete({ id: commentId });
//       } else if (action === 'spam') {
//         await youtube.comments.setModerationStatus({
//           id: commentId,
//           moderationStatus: 'likelySpam'
//         });
//       } else if (action === 'reject') {
//         await youtube.comments.setModerationStatus({
//           id: commentId,
//           moderationStatus: 'rejected'
//         });
//       } else if (action === 'report') {
//         // untuk user non-owner, bisa kirim log laporan (bisa simpan di DB)
//         console.log(`Report spam: ${commentId}`);
//       }
//     }

//     return res.redirect(`/komentar_spam?videoId=${videoId}`);
//   } catch (error) {
//     console.error('Error moderasi komentar:', error);
//     return res.status(500).send('Terjadi kesalahan moderasi komentar');
//   }
// };
