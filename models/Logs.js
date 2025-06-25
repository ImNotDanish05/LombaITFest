const mongoose = require('mongoose');

const logsSchema = new mongoose.Schema({
    user_id: {type: String, required: true},
    action: {type: String, required: true},
    comment_id: {type: String, required: true},
    video_id : {type: String, required: true},
    timestamp : {type: Date, default: Date.now},
    status: {type: String, required: true},
    message: {type: String, required: true}
})

module.exports = mongoose.model('Logs', logsSchema);