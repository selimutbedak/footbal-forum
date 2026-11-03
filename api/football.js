
export default async function handler(req, res) {
  const apiKey = process.env.API_FOOTBALL_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "API_FOOTBALL_KEY belum dipasang di Vercel"
    });
  }

  const type = req.query.type || "fixtures";

  const endpoints = {
    fixtures: "fixtures",
    livescores: "fixtures",
    leagues: "leagues"
  };

  if (!endpoints[type]) {
    return res.status(400).json({
      error: "Jenis data tidak valid"
    });
  }

  try {
    const url = new URL(
      `https://v3.football.api-sports.io/${endpoints[type]}`
    );

    // Zona waktu Indonesia
    url.searchParams.set("timezone", "Asia/Jakarta");

    if (type === "livescores") {
      url.searchParams.set("live", "all");
    }

    if (type === "fixtures") {
      url.searchParams.set(
        "date",
        req.query.date || new Date().toISOString().slice(0, 10)
      );
    }

    const response = await fetch(url, {
      headers: {
        "x-apisports-key": apiKey
      }
    });

    const data = await response.json();

    return res.status(response.status).json(data);

  } catch (error) {
    return res.status(500).json({
      error: "Gagal menghubungi API-Football",
      details: error.message
    });
  }
}
