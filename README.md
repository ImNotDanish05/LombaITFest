# 🎯 YouTube Judol Comment Remover

A web-based tool that allows users to safely and securely scan their own YouTube videos for misleading or clickbait ("judol") comments and automatically remove them.

---

## 📌 Features

- 🔒 **Google OAuth2 Login** – Secure login with your Google account.
- 🎥 **Video Comment Scan** – View all comments from your own videos.
- 🧠 **AI-Powered Judol Detection** – Automatically detect "judol" (clickbait) comments using text analysis.
- 🧹 **One-Click Removal** – Instantly delete flagged comments with your permission.
- ⚙️ **Blacklist Word Settings** – Customize which keywords you consider "judol".

---

## 📷 Preview

> _Demo UI coming soon._

---

## 🛠️ Tech Stack

| Area         | Tech Used               |
|--------------|--------------------------|
| Frontend     | HTML, Tailwind CSS, EJS or React |
| Backend      | Node.js, Express         |
| Database     | MongoDB + Mongoose       |
| Auth & API   | Google OAuth2, YouTube Data API |
| Hosting      | (To be decided)          |

---

## 🔐 How We Handle Your Data

- We only store the **minimum required data** to access YouTube comment management.
- Your **refresh token and access token** are stored securely and encrypted.
- All data is only used to manage your YouTube comments, and is never shared.

---

## 🚧 Installation (Local Dev)

```bash
git clone https://github.com/your-username/judol-remover.git
cd judol-remover
npm install
npm start
