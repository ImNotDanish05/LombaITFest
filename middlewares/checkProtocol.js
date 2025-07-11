module.exports = function (req, res, next) {
  const host = req.hostname; // misalnya: localhost atau www.danishsenpai.com
  const protocol = req.protocol; // http atau https

  // Kalau localhost, allow http
  if (host === 'localhost' || host.startsWith('127.0.0.1')) {
    return next();
  }

  // Kalau bukan localhost, HARUS https
  if (protocol !== 'https') {
    return res.status(403).send('⚠️ Akses ditolak: hanya HTTPS yang diizinkan untuk domain publik.');
  }

  next();
};
