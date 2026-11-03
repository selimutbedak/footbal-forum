
export default async function handler(req, res) {
  const API_KEY = process.env.API_FOOTBALL_KEY;

  if (!API_KEY) {
    return res.status(500).json({
      error: "API_FOOTBALL_KEY belum dipasang di Vercel"
    });
  }

  const type = req.query.type || "fixtures";

  const endpoints = {
    leagues: "leagues",
    fixtures: "fixtures",
    livescores: "fixtures",
    fixture: "fixtures",
    statistics: "fixtures/statistics",
    lineups: "fixtures/lineups",
    players: "fixtures/players",
    h2h: "fixtures/headtohead",
    predictions: "predictions"
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

    const params = {
      timezone: "Asia/Jakarta",
      date: req.query.date,
      league: req.query.league,
      season: req.query.season,
      id: req.query.id,
      live: req.query.live,
      fixture: req.query.fixture,
      h2h: req.query.h2h,
      last: req.query.last,
      current: req.query.current
    };

    if (type === "leagues") {
      params.current = "true";
    }

    if (type === "livescores") {
      params.live = "all";
    }

    if (type === "statistics" ||
        type === "lineups" ||
        type === "players" ||
        type === "predictions") {
      params.fixture = req.query.fixture;
    }

    if (type === "h2h") {
      params.h2h = req.query.h2h;
      params.last = req.query.last || "10";
    }

    if (type === "fixture") {
      params.id = req.query.id;
    }

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }

    if (
      ["statistics", "lineups", "players",
       "predictions", "fixture", "h2h"].includes(type)
    ) {
      const required = {
        statistics: "fixture",
        lineups: "fixture",
        players: "fixture",
        predictions: "fixture",
        fixture: "id",
        h2h: "h2h"
      };

      const field = required[type];

      if (!req.query[field]) {
        return res.status(400).json({
          error: `Parameter ${field} wajib diisi`
        });
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        "x-apisports-key": API_KEY
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
