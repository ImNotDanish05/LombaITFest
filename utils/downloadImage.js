// utils/downloadImage.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function downloadImage(url, filename) {
  const folderPath = path.join(__dirname, '..', 'public', 'uploads', 'profile');
  const filePath = path.join(folderPath, filename);

  try {
    // Pastikan folder ada
    fs.mkdirSync(folderPath, { recursive: true });

    // Ambil gambar dari URL
    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 10000, // kasih timeout biar nggak nunggu lama kalau lambat
    });

    // Tulis ke file lokal
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(`/uploads/profile/${filename}`)); // Path untuk disimpan di DB
      writer.on('error', (err) => {
        fs.unlinkSync(filePath); // hapus file gagal download
        reject(err);
      });
    });

  } catch (err) {
    console.error('Gagal download gambar:', err.message);
    return null; // atau bisa fallback ke default image
  }
}

module.exports = downloadImage;
