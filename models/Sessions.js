const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    user_google_id: { type: String, required: true }, // ini relasi ke google_id user
    session_id: { type: String, required: true, unique: true }, // ini session token yang nanti disimpan di cookie
    created_at: { type: Date, default: Date.now },
    expires_at: { type: Date, required: true }
})

module.exports = mongoose.model('Sessions', sessionSchema);