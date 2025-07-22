const fs            = require('fs');
const path          = require('path');
const http          = require('http');
const https         = require('https');
const express       = require('express');
const socketio      = require('socket.io');
const cors          = require('cors');
const bodyParser    = require('body-parser');
const cookieParser  = require('cookie-parser');
const session       = require('express-session');
const mongoose      = require('mongoose');

const checkProtocol       = require('./middlewares/checkProtocol');
const { checkSession }    = require('./controllers/authSession');
const isProductionHttps   = require('./utils/isProductionHttps');
const { loadYoutubeCredentials } = require('./utils/LoadData');
const { setPriority } = require('os');

const app         = express();
const ytCreds     = loadYoutubeCredentials();


app.use(checkProtocol);
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(session({
  secret: ytCreds.client_secret,
  resave: false,
  saveUninitialized: true
}));

app.use('/', require('./routes/index'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/youtube'));
app.use('/', require('./routes/judol'));
app.use('/', require('./routes/youtubeComments'));
app.use('/', require('./routes/home'));
app.use('/', require('./routes/success'));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));



app.use((req, res, next) => {
  const err   = new Error('❌ Halaman tidak ditemukan.');
  err.status  = 404;
  err.backUrl = '/dashboard';
  next(err);
});

app.use(async (err, req, res, _next) => {
  console.error(err.stack);
  let user = null;
  try { user = req.user || await checkSession(req); } catch {}

  res.status(err.status || 500).render('pages/eror', {
    title : 'Error',
    user  : user,
    error : {
      code   : err.status || 500,
      message: err.message || 'Terjadi kesalahan.'
    },
    backUrl: user ? err.backUrl : '/'
  });
});

const startServer = async () => {
  try {
    await mongoose.connect(
      'mongodb+srv://public:DIKpwpcctrx9hIeZ@youtubedata.cqgmi5j.mongodb.net/dbKontenJudol'
    );
    console.log('✅ MongoDB Atlas connected');

    const useHttps = isProductionHttps();
    console.log('Https mode:', useHttps);

    /* a. buat server (http atau https) */
    let server;
    if (useHttps) {
      const creds = {
        key : fs.readFileSync('/etc/letsencrypt/live/novaclean.danish05.my.id/privkey.pem',  'utf8'),
        cert: fs.readFileSync('/etc/letsencrypt/live/novaclean.danish05.my.id/fullchain.pem','utf8')
      };
      server = https.createServer(creds, app);
    } else {
      server = http.createServer(app);
    }

    /* b. attach Socket.IO sekali saja */
    const io = socketio(server);
    app.set('io', io);                       // simpan di app untuk dipakai di route
    global.io = io;                          // opsi global (hindari redeclare)

    io.on('connection', socket => {
      console.log('🔌 Client connected:', socket.id);
      socket.on('disconnect', () =>
        console.log('🔌 Client disconnected:', socket.id)
      );
    });

    /* c. hidupkan server */
    const PORT = process.env.PORT || 3000;
    server.listen(useHttps ? 443 : PORT, () => {
      console.log(
        useHttps
          ? '🔐 HTTPS Server running on port 443'
          : `🌐 HTTP Server running on http://localhost:${PORT}\n   🔐 Login: http://localhost:${PORT}/login`
      );
    });

  } catch (err) {
    console.error('❌ Gagal memulai server:', err);
    process.exit(1);
  }
};

startServer();
