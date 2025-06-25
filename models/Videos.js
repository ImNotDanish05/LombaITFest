const mongoose = require('mongoose');

const videosSchema = new mongoose.Schema({
    user_id: { type: String, required: true },
    video_id: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    published_at: { type: Date, required: true },
    thumbnail_url: { type: String, required: true },
    comments_count: { type: Number, required: true},
    is_processed: { type: Boolean, required: true, default: false},
    created_at: { type: Date, required: true},
})

module.exports = mongoose.model('Videos', videosSchema);