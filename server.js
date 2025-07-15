
const http = require('http');
const https = require('https');
require('dotenv').config({ path: './backend/config/.env' });

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const mongoose = require('mongoose');
const fs = require('fs');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const checkProtocol = require('./middlewares/checkProtocol');
const { checkSession, authSession } = require('./controllers/authSession');
const isProductionHttps = require('./utils/isProductionHttps');
const youtubeCommentsRouter = require('./routes/youtubeComments');

const app = express();

// Middleware
app.use(checkProtocol);
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // ⬅️ Tambahan untuk akses foto
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(session({
  secret: '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',
  resave: false,
  saveUninitialized: true
}));

// Routes
app.use('/', require('./routes/youtube'));
app.use('/', require('./routes/index'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/youtubeComments'));
app.use('/', require('./routes/judol'));
app.use('/', require('./routes/home'));

// Handle 404 (Route not found)
app.use(async (req, res) => {
  const user = await checkSession(req);

  res.status(404).render('pages/eror', {
    title: '404 - Halaman Tidak Ditemukan',
    error: {
      code: 404,
      message: `Halaman ${req.originalUrl} tidak ditemukan`
    },
    user:user
  });
});


// Fungsi async untuk connect MongoDB dan start server
const startServer = async () => {
  try {
    // ✅ MongoDB Connect
    await mongoose.connect('mongodb+srv://syauqi:RU5Jch8oORT91cnL@youtubedata.cqgmi5j.mongodb.net/dbKontenJudol');
    console.log('✅ MongoDB Atlas connected');

    // ✅ Start Server (HTTPS atau HTTP)
    console.log('Https mode:', isProductionHttps());

    if (isProductionHttps()) {
      const privateKey = fs.readFileSync('/etc/letsencrypt/live/novaclean.danish05.my.id/privkey.pem', 'utf8');
      const certificate = fs.readFileSync('/etc/letsencrypt/live/novaclean.danish05.my.id/fullchain.pem', 'utf8');
      const credentials = { key: privateKey, cert: certificate };

      https.createServer(credentials, app).listen(443, () => {
        console.log('🔐 HTTPS Server running on port 443');
      });
    } else {
      const port = process.env.PORT || 3000;
      http.createServer(app).listen(port, () => {
        console.log(`🌐 HTTP Server running on http://localhost:${port}`);
        console.log(`🔐 Login: http://localhost:${port}/login`);
      });
    }
  } catch (error) {
    console.error('❌ Gagal memulai server:', error);
    process.exit(1); // keluar dengan error
  }
};

startServer();
