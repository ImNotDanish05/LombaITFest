const mongoose = require('mongoose');

const channelsSchema = new mongoose.Schema({
    user_id : {type: String, required: true},
    channel_id : {type: String, required: true},
    title: {type: String, required: true},
    subscribers: {type: Number, required: true, default: 0},
    created_at: {type: Date, default: Date.now},
    is_active: {type: Boolean, required: true, default: true},
})

module.exports = mongoose.model('Channels', channelsSchema);