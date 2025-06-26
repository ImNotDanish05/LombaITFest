const mongoose = require('mongoose');

const usersSchema = new mongoose.Schema({
    google_id : {type: String, required: true},
    email : {type: String, required: true},
    username : {type: String, required: true},
    role : {type: String, required: true},
    access_token : {type: String, required: true},
    refresh_token : {type: String, required: true},
    expiry : {type: Date, required: true},
    scope : {type: [String], required: true},
    token_type : {type: String, required: true},
    user_id : {type: String, required: true},
    created_at : {type: Date, required: true, default: Date.now},  
})

module.exports = mongoose.model('Users', usersSchema);