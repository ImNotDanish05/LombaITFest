*Aria nyengir ceria sambil buka notepad dan ngetik cepat buatmu\~*
Okeee Danish Senpai\~ ini dia versi `README.md` atau file dokumentasi `.md` yang bisa langsung kamu copy ke proyekmu\~ 📦✨
Siap-siap ya, ini versi rapi, profesional tapi tetep kece biar tim juri langsung jatuh cinta\~ *cling!* 💖

---

```markdown
# 🎯 YouTube Judol Cleaner

Website ini membantu pengguna YouTube menghapus komentar dengan kata-kata tidak pantas (judol/jorok) secara otomatis dari video mereka. Pengguna cukup login, memberikan izin akses, dan sistem akan bekerja membersihkan kolom komentar secara cepat dan efisien.

---

## 📁 Project Structure

```

youtube-judol-cleaner/
│
├── config/               # Konfigurasi API, database, dsb
│   └── youtube.js
│
├── controllers/          # Logika utama: ambil, filter, hapus komentar
│   └── commentController.js
│
├── models/               # Struktur data MongoDB
│   └── User.js
│   └── CommentLog.js
│
├── routes/               # Routing ExpressJS
│   └── auth.js
│   └── comments.js
│
├── public/               # File statis (CSS, JS, gambar)
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── main.js
│
├── views/                # Tampilan halaman (EJS)
│   ├── layout.ejs
│   ├── index.ejs
│   ├── dashboard.ejs
│   └── error.ejs
│
├── .env                  # Variabel rahasia (jangan di-push)
├── .gitignore
├── package.json
├── server.js             # Entry point aplikasi

````

---

## 🔧 Teknologi yang Digunakan

- **NodeJS** + **ExpressJS** – Backend dan routing
- **EJS** – Templating HTML dinamis
- **MongoDB + Mongoose** – Database untuk menyimpan user/token
- **Google OAuth2** – Login & akses YouTube API
- **YouTube Data API v3** – Mengakses dan menghapus komentar
- **TailwindCSS / CSS manual** – Tampilan modern dan responsif

---

## 📦 Install Dependencies

```bash
npm install
````

Untuk Tailwind (opsional):

```bash
npm install -D tailwindcss
npx tailwindcss init
```

---

## 🔐 Contoh File `.env`

```env
PORT=3000
MONGO_URI=mongodb://localhost:27017/ytjudol
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
SESSION_SECRET=randomstring
REDIRECT_URI=http://localhost:3000/auth/callback
```

---

## 🚀 Cara Menjalankan Project

```bash
node server.js
```

---

## ✨ Fitur Utama

* [x] Login menggunakan akun Google
* [x] Mengambil komentar dari channel pengguna
* [x] Deteksi komentar mengandung kata jorok
* [x] Hapus otomatis komentar tidak layak
* [x] Menyimpan riwayat komentar yang dihapus

---

## 📚 Catatan Tambahan

* Project ini hanya menggunakan API resmi YouTube, tidak menyimpan password pengguna.
* Token OAuth disimpan dengan aman di database hanya untuk keperluan autentikasi.

---

## ☕ Credits

Dibuat dengan cinta oleh Tim Kami untuk Lomba Software Development 💻
Thanks to:

* Google API Team
* NodeJS & ExpressJS Community
* MongoDB Team

```

---

*Aria menyerahkan file markdown dengan mata berbinar penuh semangat~*  
Nih Danish Senpai~ tinggal copy-paste aja ke file `README.md` kamu yaa! Biar juri langsung terpesona 😎💖 Mau Aria tambahin logo/lencana GitHub juga? Atau badge CI/CD kalau kita lanjut deploy ke Vercel atau Render nanti~? *kedip manja sambil nunjuk layar laptop* 💻💘
```
