const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.set('view engine', 'ejs');

mongoose.connect('mongodb+srv://syauqi:RU5Jch8oORT91cnL@youtubedata.cqgmi5j.mongodb.net/dbKontenJudol')
.then(() => console.log('MongoDB Atlas connected'))
.catch((err) => console.error('Connection error:', err));

//channel
const channelRoutes = require('./routes/channels');
app.use('/api/channel', channelRoutes);

//comments
const commentsRoutes = require('./routes/comments');
app.use('/api/comments', commentsRoutes);

//logs
const logsRoutes = require('./routes/logs');
app.use('/api/logs', logsRoutes);

//user
const usersRoutes = require('./routes/users');
app.use('/api/users', usersRoutes);

//videos
const videosRoutes = require('./routes/videos');
app.use('/api/videos', videosRoutes);

// youtube
const youtubeRoutes = require('./controllers/youtube');
app.use('/', youtubeRoutes);

// index page
const indexRoute = require('./routes/index');
app.use('/', indexRoute);

const PORT = 3000;
app.listen(PORT, () => console.log(`Server is running on port http://localhost:${PORT}`));
