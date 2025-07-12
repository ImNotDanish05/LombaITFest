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
const isProductionHttps = require('./utils/isProductionHttps');

const app = express();

// Middleware setup
app.use(checkProtocol);
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(session({
  secret: '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',
  resave: false,
  saveUninitialized: true
}));

// MongoDB connection
mongoose.connect('mongodb+srv://syauqi:RU5Jch8oORT91cnL@youtubedata.cqgmi5j.mongodb.net/dbKontenJudol')
  .then(() => console.log('MongoDB Atlas connected'))
  .catch((err) => console.error('Connection error:', err));

// Routes
app.use('/api/channel', require('./routes/channels'));
app.use('/api/comments', require('./routes/comments'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/users', require('./routes/users'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/sessions', require('./routes/sessions'));
app.use('/', require('./routes/youtube'));
app.use('/', require('./routes/index'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/youtubeComments'));


// Jalankan server (HTTPS atau HTTP)
console.log('Https mode:', isProductionHttps());
if (isProductionHttps()) {
  const privateKey = fs.readFileSync('/etc/letsencrypt/live/ytjudolremover.danish05.my.id/privkey.pem', 'utf8');
  const certificate = fs.readFileSync('/etc/letsencrypt/live/ytjudolremover.danish05.my.id/fullchain.pem', 'utf8');
  const credentials = { key: privateKey, cert: certificate };
  https.createServer(credentials, app).listen(443, () => {
    console.log('HTTPS Server running on port 443');
  });
} else {
  http.createServer(app).listen(3000, () => {
    console.log('HTTP Server running on port 3000');
    console.log(`✅ Server aktif di http://localhost:${process.env.PORT || 3000}`);
    console.log(`🔐 Login: http://localhost:${process.env.PORT || 3000}/login`);
  });
}
