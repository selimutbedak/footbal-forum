
export default async function handler(req, res) {
  const token = process.env.SPORTMONKS_API_TOKEN;

  if (!token) {
    return res.status(500).json({
      error: "SPORTMONKS_API_TOKEN belum dipasang"
    });
  }

  const type = req.query.type || "livescores";

  const endpoints = {
    livescores: "livescores/inplay",
    fixtures: "livescores",
    players: "players"
  };

  if (!endpoints[type]) {
    return res.status(400).json({
      error: "Jenis data tidak valid"
    });
  }

  try {
    const url = new URL(
      `https://api.sportmonks.com/v3/football/${endpoints[type]}`
    );

    url.searchParams.set("api_token", token);

    if (type === "livescores") {
      url.searchParams.set(
        "include",
        "participants;scores;events;league;state"
      );
    }

    if (type === "fixtures") {
      url.searchParams.set("include", "participants;scores;league;state");
    }

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Sportmonks API gagal",
        details: data
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({
      error: "Gagal menghubungi Sportmonks",
      details: error.message
    });
  }
}
