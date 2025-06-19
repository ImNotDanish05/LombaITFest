require('dotenv').config();
const axios = require('axios');

async function classifyComments(comments) {
  try {
    const prompt = `Jawab komentar ini dengan jawaban yang pendek

Komentar:
${comments.map((c, i) => `${i+1}. "${c}"`).join('\n')}`;

    const res = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: "deepseek/deepseek-chat-v3-0324:free",
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.0,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const content = res.data.choices[0].message.content.trim();
    return content.split('\n').map(x => x.trim());
  } catch (err) {
    console.error("❌ EROR classifyComments:", err.response?.data || err.message);
    return null;
  }
}

(async () => {
  const test = [
    "Haiii!",
    "Apa kabar ?",
    "Mantaaap",
  ];
  const hasil = await classifyComments(test);
  console.log("Hasil:", hasil);  // e.g., ['1', '0', '0']
})();