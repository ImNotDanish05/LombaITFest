const mongoose = require('mongoose');

const commentsSchema = new mongoose.Schema({
    video_id : {type: String, required: true},
    comment_id : {type: String, required: true},
    author_name : {type: String, required: true},
    text : {type: String, required: true},
    published_at : {type: Date, required: true},
    is_judol : {type: Boolean, required: true, default: false},
});

module.exports = mongoose.model('Comments', commentsSchema);