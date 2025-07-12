//
// Untuk menkonversi data dari apapun
// Contoh dari json, csv, dll, menjadi variable yang mudah digunakan
//

const fs = require('fs');
const path = require('path');
const prefix = "[LoadData.js]"

//
// Ambil data JSON CREDENTIALS
// Import: const LoadData = require('./utils/LoadData');
//

function loadYoutubeCredentials() {
    try {
        // 1. Ambil data dari json
        const credentials_youtube_api_filePath = path.join(__dirname, "../config/credentials_youtube_api.json");

        // 2. Baca data json
        const credentials_youtube_api_fileContent = fs.readFileSync(credentials_youtube_api_filePath, 'utf-8');

        // 3. Parse ke bentuk json
        const credentials_youtube_api = JSON.parse(credentials_youtube_api_fileContent);
        const credentials_youtube_api_web = credentials_youtube_api.web;

        const client_id = credentials_youtube_api_web.client_id;
        const project_id = credentials_youtube_api_web.project_id;
        const auth_uri = credentials_youtube_api_web.auth_uri;
        const token_uri = credentials_youtube_api_web.token_uri;
        const auth_provider_x509_cert_url = credentials_youtube_api_web.auth_provider_x509_cert_url;
        const client_secret = credentials_youtube_api_web.client_secret;
        const redirect_uris = credentials_youtube_api_web.redirect_uris;
        const javascript_origins = credentials_youtube_api_web.javascript_origins;
        console.log(`${prefix} ✔ Berhasil load credentials_youtube_api.json`)
        return {
            client_id,
            project_id,
            auth_uri,
            token_uri,
            auth_provider_x509_cert_url,
            client_secret,
            redirect_uris,
            javascript_origins
        };
    }
    catch (err){
        console.error(`${prefix} ❌ Gagal load credentials_youtube_api.json: ${err.message}`)
    }
    
}

module.exports = {
  loadYoutubeCredentials
};