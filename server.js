require('dotenv').config({ path: './backend/config/.env' }); // Pastikan path ke .env benar
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const { google } = require('googleapis');
const { getVideoIdFromUrl } = require('./controllers/youtube/index');
const { getJudolComment, getJudolCommentAi } = require('./controllers/comment_get_judol');
const authSession  = require('./controllers/authSession');
const Users = require('./models/Users');
const LoadData = require('./utils/LoadData');
const Sessions = require('./models/Sessions');
const fs = require('fs');

const session = require('express-session');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: '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', // ganti dengan secret yang aman
  resave: false,
  saveUninitialized: true
}));

mongoose.connect('mongodb+srv://syauqi:RU5Jch8oORT91cnL@youtubedata.cqgmi5j.mongodb.net/dbKontenJudol')
.then(() => console.log('MongoDB Atlas connected'))
.catch((err) => console.error('Connection error:', err));

// channel
const channelRoutes = require('./routes/channels');
app.use('/api/channel', channelRoutes);

// comments
const commentsRoutes = require('./routes/comments');
app.use('/api/comments', commentsRoutes);

// logs
const logsRoutes = require('./routes/logs');
app.use('/api/logs', logsRoutes);

// user
const usersRoutes = require('./routes/users');
app.use('/api/users', usersRoutes);

// videos
const videosRoutes = require('./routes/videos');
app.use('/api/videos', videosRoutes);

// sessions
const sessionsRoutes = require('./routes/sessions');
app.use('/api/sessions', sessionsRoutes);

// youtube
const youtubeRoutes = require('./routes/youtube');
app.use('/', youtubeRoutes);

// index page
const indexRoute = require('./routes/index');
app.use('/', indexRoute);

// Debug: cek apakah env terbaca
console.log('CLIENT_ID:', process.env.GOOGLE_CLIENT_ID);
console.log('CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET);
console.log('REDIRECT_URI:', process.env.REDIRECT_URI);

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'openid',
  'email',
  'profile'
];

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
);

//route home
app.get('/home', (req, res) => {
  res.render('pages/home');
});

// Endpoint login
app.get('/login', async (req, res) => {
  // Cek dulu apakah ada session_id di cookies
  const session_id = req.cookies.session_id;
  if (session_id) {
    // Cari session di DB
    const session = await Sessions.findOne({ session_id });
    if (session && session.expires_at > Date.now()) {
      // Cari user juga
      const user = await Users.findOne({ google_id: session.google_id });
      if (user) {
        // Kalau valid, langsung redirect ke dashboard
        console.log('User sudah login, redirect ke dashboard');
        console.log('session_id:', session_id);
        return res.redirect('/dashboard/');
      }
    }
  }
  console.log('Tidak ada session_id atau session tidak valid, tampilkan halaman login');
  console.log('session_id:', session_id);
  // Kalau nggak ada / nggak valid, render login page
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });
  res.render('pages/login', { googleLoginUrl: url });
});


app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send('Kode otorisasi tidak ditemukan.');

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Ambil info user dari Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userinfo = await oauth2.userinfo.get();

    // Simpan/update ke MongoDB
    const user = await Users.findOneAndUpdate(
      { google_id: userinfo.data.id },
      {
        google_id: userinfo.data.id,
        email: userinfo.data.email,
        username: userinfo.data.name,
        picture: userinfo.data.picture, // <-- Tambahkan baris ini!
        role: 'user',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry: new Date(tokens.expiry_date),
        scope: Array.isArray(tokens.scope) ? tokens.scope : (tokens.scope ? tokens.scope.split(' ') : []),
        token_type: tokens.token_type,
        user_id: userinfo.data.id,
        created_at: new Date()
      },
      { upsert: true, new: true }
    );
    const session_id = uuidv4();
    const session = await Sessions.findOneAndUpdate(
      { google_id: userinfo.data.id },
      {
        google_id: userinfo.data.id,
        session_id: session_id, // Simpan access token sebagai session_id
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 hari
      },
      { upsert: true, new: true }
    );
    // Set cookie user_id untuk auto-login
    // Disini berarti 7 hari (24 * 60 * 60 * 1000 ms artinya 1 hari)
    res.cookie('session_id', session_id, {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 hari
      httpOnly: true
    });
    res.redirect('/dashboard/'); // atau ke route dashboard yang sesuai
  } catch (error) {
    console.error('Error during OAuth callback:', error);
    res.status(500).send('Terjadi kesalahan saat otentikasi.');
  }
});

// // Dashboard dengan id (akses setelah login)
// app.get('/dashboard/:id', authSession, async (req, res) => {
//   try {
//     let userId = req.params.id;
//     if (!userId && req.cookies.user_id) {
//       userId = req.cookies.user_id;
//     }
//     if (!userId) return res.redirect('/');
//     const user = await Users.findById(userId).lean();
//     if (!user) return res.redirect('/');
//     res.render('pages/dashboard', {
//       user: {
//         name: user.username,
//         email: user.email,
//         picture: user.picture
//       }
//     });
//   } catch (error) {
//     res.status(500).send('Gagal mengambil data user.');
//   }
// });

// Dashboard tanpa id (akses otomatis via cookie)
app.get('/dashboard', authSession, async (req, res) => {
  const userId = req.user;
  if (!userId) return res.redirect('/');
  const user = await Users.findById(userId).lean();
  if (!user) {
    res.clearCookie('user_id');
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

// --- HAPUS AKUN: Hapus user dari DB dan hapus cookie ---
app.get('/delete-account', authSession, async (req, res) => {
  try {
    const userId = req.cookies.user_id;
    if (userId) {
      await Users.findByIdAndDelete(userId);
      res.clearCookie('user_id');
    }
    res.redirect('/'); // Atau ke halaman login
  } catch (err) {
    res.status(500).send('Gagal menghapus akun.');
  }
});

// Route POST get-comments
app.post('/get-comments', authSession, async (req, res) => {
  try {
    const useAi = req.body.useAiJudol === '1';
    const youtubeUrl = req.body.youtubeUrl;
    const match = getVideoIdFromUrl(youtubeUrl);
    if (!match) return res.status(400).send('Link YouTube tidak valid.');
    const videoId = match;

    oauth2Client.setCredentials({
      access_token: req.user.access_token,
      refresh_token: req.user.refresh_token
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Mengambil data akun youtube user
    const channelResponse = await youtube.channels.list({
      part: 'id,snippet',
      mine: true
    });
    const userChannelId = channelResponse.data.items[0].id;

    // Mengambil data akun pemilik video
    const videoResponse = await youtube.videos.list({
      part: 'snippet',
      id: videoId
    });
    const videoChannelId = videoResponse.data.items[0].snippet.channelId;

    // Cek apakah user yang login adalah pemilik video
    const isOwner = userChannelId === videoChannelId;
    if (isOwner) {
      console.log("Ini video milik user sendiri!");
    } else {
      console.log("Ini video orang lain!");
    }

    let allComments = [];
    let nextPageToken = null;
    let count = 0;
    console.log(`Mengambil komentar untuk video ID: ${videoId}`);
    console.log('Sebagai:', req.user.username);
    console.log('Pakai AI Judol Detector: ', useAi);
    do {
      count++;
      console.log(`Mengambil batch ${count} komentar...`);
      const response = await youtube.commentThreads.list({
        part: 'snippet',
        videoId,
        maxResults: 100,
        pageToken: nextPageToken || ''
      });

      const commentsBatch = response.data.items.map(item => ({
        text: item.snippet.topLevelComment.snippet.textDisplay,
        commentId: item.snippet.topLevelComment.id
      }));

      allComments = allComments.concat(commentsBatch);
      nextPageToken = response.data.nextPageToken;
    } while (nextPageToken);

    console.log(`Total komentar yang diambil: ${allComments.length}`);

    // Deteksi spam manual & AI
    // allComments.map itu fungsinya untuk output array boolean (contoh: [true, false, true]) dan itu disimpan di manualResults
    // Jadi manualResults[i] itu isinya true/false apakah komentar ke-i terdeteksi sebagai spam secara manual
    console.log('Mulai deteksi spam manual...');
    const manualResults = allComments.map(c => getJudolComment(c.text));


    // notDetectedManually adalah komentar yang tidak terdeteksi sebagai spam secara manual
    const notDetectedManually = allComments.filter(
      (c, i) => !manualResults[i]
    )
    .map(c => c.text);


    // aiResults adalah hasil dari AI yang akan diisi nanti. Output dari AIini adalah array boolean juga, hanya saja menggunakan 1/0 sebagai output (1 untuk spam, 0 untuk bukan spam)
    // Jadi aiResults[i] itu isinya 1/0 apakah komentar ke-i terdeteksi sebagai spam oleh AI
    // Jika tidak ada komentar yang tidak terdeteksi secara manual, maka aiResults akan kosong
    console.log(`Komentar yang tidak terdeteksi manual: ${notDetectedManually.length}`);
    if (useAi){
      console.log('Mulai deteksi spam dengan AI...');
      let aiResults = [];
      if (notDetectedManually.length > 0) {
        aiResults = await getJudolCommentAi(notDetectedManually);
      }
      console.log(`AI selesai mendeteksi spam, hasil: ${aiResults.length} komentar`);
    }
    


    // Gabungkan hasil manual & AI
    // spamResults adalah hasil akhir yang akan digunakan untuk menandai komentar sebagai spam atau tidak
    // Jadi spamResults[i] itu isinya 1/0 apakah komentar ke-i terdeteksi sebagai spam
    console.log('Menggabungkan hasil manual dan AI...');
    let spamResults = [];
    let aiIdx = 0;
    for (let i = 0; i < allComments.length; i++) {
      console.log(`Memproses komentar ${i + 1}/${allComments.length}`);
      if (manualResults[i]) {
        spamResults.push(1);
      } else {
        if (useAi){
          spamResults.push(aiResults[aiIdx++] || 0);
        }
        else {
          spamResults.push(0);
        }
      }
    }

    // Debugging: tampilkan jumlah komentar dan spam
    // console.log('Semua Komentar:');
    // console.log(allComments);
    // console.log('manualResults:', manualResults);
    // console.log('notDetectedManually:', notDetectedManually);
    // console.log('aiResults:', aiResults);
    // console.log('spamResults:', spamResults);

    // const debugData = {
    //   semuaKomentar: allComments,
    //   manualResults,
    //   notDetectedManually,
    //   aiResults,
    //   spamResults
    // };

    // // Simpan jadi JSON biar rapi:
    // fs.writeFileSync('debug-log.json', JSON.stringify(debugData, null, 2), 'utf-8');


    // Gabungkan spam ke komentar
    const cleanAllComments = allComments.map(c => ({
      ...c,
      text: c.text.replace(/<[^>]+>/g, ' ')
    }));

    const commentsWithSpam = cleanAllComments.map((c, i) => ({
      ...c, // ...c akan menyebarkan semua properti dari komentar
      isSpam: spamResults[i]
    }));

    // Filter hanya yang isSpam true
    const onlySpamComments = commentsWithSpam.filter(c => c.isSpam);

    // Debug log tetap semua (atau juga bisa onlySpamComments kalau mau)
    const debugData = {
      semuaKomentar: onlySpamComments
    };

    fs.writeFileSync('debug-log.json', JSON.stringify(debugData, null, 2), 'utf-8');

    res.render('pages/komentar_spam', {
      user: {
        name: req.user.username,
        email: req.user.email,
        picture: req.user.picture,
        isOwner: isOwner
      },
      comments: onlySpamComments
      
    });
  } catch (err) {
    console.error('YouTube API error:', err);
    res.status(500).send('Gagal mengambil komentar.');
  }
});


// Route POST delete-comments
app.post('/delete-comments', authSession, async (req, res) => {
  let selectedIds = req.body.ids;
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
      selectedIds: selectedIds.length
    });
  } catch (err) {
    console.error('Gagal memproses komentar:', err);
    res.status(500).send('Gagal memproses komentar.');
  }
});



app.get('/', async (req, res) => {
  let isLoggedIn = false;
  if (req.cookies.user_id) {
    const user = await Users.findById(req.cookies.user_id).lean();
    if (user) {
      isLoggedIn = true;
    } else {
      res.clearCookie('user_id');
    }
  }
  res.render('pages/home', { isLoggedIn });
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`✅ Server aktif di http://localhost:${process.env.PORT || 3000}`);
  console.log(`🔐 Login: http://localhost:${process.env.PORT || 3000}/login`);
});