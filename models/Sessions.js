const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  google_id: { type: String, required: true }, // relasi ke user
  session_id: { type: String, required: true, unique: true }, // random token panjang
  session_secret: { type: String, required: true }, // random token panjang juga
  user_agent: { type: String, required: true }, // fingerprint tambahan
  created_at: { type: Date, default: Date.now },
  expires_at: { type: Date, required: true }
});

module.exports = mongoose.model('Sessions', sessionSchema);