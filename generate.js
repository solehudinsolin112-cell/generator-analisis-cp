
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const RESPONSE_SCHEMA = {
  "type": "object",
  "properties": {
    "metadata": {
      "type": "object",
      "properties": {
        "mapel": {
          "type": "string"
        },
        "fase": {
          "type": "string"
        },
        "elemen": {
          "type": "string"
        },
        "cp": {
          "type": "string"
        },
        "rentang_kelas": {
          "type": "string"
        }
      },
      "required": [
        "mapel",
        "fase",
        "elemen",
        "cp",
        "rentang_kelas"
      ]
    },
    "tp": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "no": {
            "type": "integer"
          },
          "rumusan_tp": {
            "type": "string"
          },
          "kelas": {
            "type": "string"
          },
          "semester": {
            "type": "integer",
            "enum": [
              1,
              2
            ]
          },
          "indikator_ringkas": {
            "type": "string"
          },
          "prasyarat_tp_no": {
            "type": "array",
            "items": {
              "type": "integer"
            }
          },
          "materi_kunci": {
            "type": "string"
          },
          "asesmen_singkat": {
            "type": "string"
          }
        },
        "required": [
          "no",
          "rumusan_tp",
          "kelas",
          "semester",
          "indikator_ringkas"
        ]
      }
    },
    "atp": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "kelas": {
            "type": "string"
          },
          "semester": {
            "type": "integer",
            "enum": [
              1,
              2
            ]
          },
          "alur_tp_no": {
            "type": "array",
            "items": {
              "type": "integer"
            }
          }
        },
        "required": [
          "kelas",
          "semester",
          "alur_tp_no"
        ]
      }
    },
    "catatan_kualitas": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "metadata",
    "tp",
    "atp"
  ]
};

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

async function readJsonBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) reject(new Error("Payload too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const faseToRentang = {
  "A": "Kelas 1–2",
  "B": "Kelas 3–4",
  "C": "Kelas 5–6",
  "D": "Kelas 7–9",
  "E": "Kelas 10",
  "F": "Kelas 11–12"
};

function buildPrompt({ mapel, fase, elemen, cp }) {
  const rentang = faseToRentang[String(fase || "").trim().toUpperCase()] || "Tidak diketahui";
  return `
Anda adalah ahli kurikulum dan perencana pembelajaran di Indonesia.

INPUT:
- Mata Pelajaran: ${mapel}
- Fase: ${fase}
- Elemen: ${elemen}
- Capaian Pembelajaran (CP): ${cp}

TUGAS:
1) Analisis CP dan pecah menjadi daftar Tujuan Pembelajaran (TP) yang runtut (dari sederhana→kompleks).
2) Tentukan Kelas & Semester otomatis berbasis fase: A=1–2, B=3–4, C=5–6, D=7–9, E=10, F=11–12.
   Untuk fase ${fase} gunakan rentang: ${rentang}.
3) Buat ATP (Alur Tujuan Pembelajaran): urutan TP per kelas & semester (alur_tp_no).
4) Tiap TP wajib punya indikator ringkas yang terukur (bukti belajar).
5) Isi materi_kunci dan asesmen_singkat secara ringkas bila memungkinkan.
6) Pastikan semua bagian CP tercakup oleh TP. Jika ada risiko kurang tercakup/ambiguitas, tulis di catatan_kualitas.
7) Output WAJIB mengikuti JSON schema terstruktur.

KAIDAH:
- Rumusan TP memakai kata kerja operasional sesuai usia.
- Semester 1: fondasi & prasyarat. Semester 2: penguatan, penerapan, produk/kinerja.
- Gunakan parafrase, jangan menyalin teks panjang berhak cipta.
  `.trim();
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return sendJson(res, 405, { ok:false, error:"Method not allowed. Use POST." });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return sendJson(res, 500, { ok:false, error:"GEMINI_API_KEY belum diset di Environment Variables." });

  let input;
  try { input = await readJsonBody(req); }
  catch (e) { return sendJson(res, 400, { ok:false, error:e.message }); }

  const mapel = (input.mapel || "").trim();
  const fase = (input.fase || "").trim().toUpperCase();
  const elemen = (input.elemen || "").trim();
  const cp = (input.cp || "").trim();

  if (!mapel || !fase || !elemen || !cp) return sendJson(res, 400, { ok:false, error:"Field wajib: mapel, fase, elemen, cp." });
  if (!faseToRentang[fase]) return sendJson(res, 400, { ok:false, error:"Fase harus A/B/C/D/E/F." });

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const prompt = buildPrompt({ mapel, fase, elemen, cp });
  const body = {
    contents: [{ role:"user", parts:[{ text: prompt }] }],
    generationConfig: {
      temperature: 0.5,
      topP: 0.9,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA
    }
  };

  try {
    const r = await fetch(url, {
      method:"POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(body)
    });
    const raw = await r.json().catch(() => null);
    if (!r.ok) return sendJson(res, 502, { ok:false, error:"Gagal memanggil Gemini API", status:r.status, details: raw });

    const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return sendJson(res, 502, { ok:false, error:"Respons Gemini tidak berisi teks kandidat", details: raw });

    let parsed;
    try { parsed = JSON.parse(text); }
    catch { return sendJson(res, 502, { ok:false, error:"Respons Gemini bukan JSON valid", rawText:text }); }

    parsed.metadata = parsed.metadata || {};
    parsed.metadata.rentang_kelas = parsed.metadata.rentang_kelas || faseToRentang[fase];
    parsed.metadata.mapel = parsed.metadata.mapel || mapel;
    parsed.metadata.fase = parsed.metadata.fase || fase;
    parsed.metadata.elemen = parsed.metadata.elemen || elemen;
    parsed.metadata.cp = parsed.metadata.cp || cp;

    return sendJson(res, 200, { ok:true, model, data: parsed });
  } catch (e) {
    return sendJson(res, 500, { ok:false, error:"Error server", message: e?.message || String(e) });
  }
};

