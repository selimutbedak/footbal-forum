
const cache = new Map();

const TTL = {
  leagues: 6 * 60 * 60 * 1000,
  matches: 30 * 1000,
  details: 2 * 60 * 1000
};

function jakartaDate(offset = 0) {
  const date = new Date(Date.now() + offset * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const p = {};
  parts.forEach(x => p[x.type] = x.value);
  return `${p.year}-${p.month}-${p.day}`;
}

function getCached(key) {
  const item = cache.get(key);
  if (!item || Date.now() > item.expires) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data, ttl) {
  cache.set(key, { data, expires: Date.now() + ttl });
}

async function requestJSON(url, key) {
  const response = await fetch(url, {
    headers: { "x-rapidapi-key": key },
    signal: AbortSignal.timeout(15000)
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Respons Highlightly bukan JSON yang valid.");
  }

  if (!response.ok) {
    const error = new Error(
      data?.message || data?.error || `Highlightly error ${response.status}`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

function sendError(res, error) {
  console.error("FOOTBALL FORUM:", error);
  return res.status(error.status || 500).json({
    error: "Gagal mengambil data Highlightly",
    message: error.message,
    providerError: error.data || null
  });
}

export default async function handler(req, res) {
  const type = String(req.query.type || "");
  const source = String(req.query.source || "highlightly");

  if (source !== "highlightly") {
    return res.status(400).json({
      error: "Sumber data yang digunakan adalah Highlightly."
    });
  }

  const key = process.env.HIGHLIGHTLY_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: "HIGHLIGHTLY_API_KEY belum dipasang di Vercel."
    });
  }

  try {
    const params = new URLSearchParams();
    let path = "";
    let ttl = TTL.details;

    if (type === "hl-leagues") {
      path = "/leagues";
      ttl = TTL.leagues;
      if (req.query.season) params.set("season", req.query.season);
      if (req.query.countryCode) params.set("countryCode", req.query.countryCode);
      if (req.query.limit) params.set("limit", req.query.limit);
    }

    else if (type === "hl-matches") {
      path = "/matches";
      ttl = TTL.matches;

      if (req.query.date) params.set("date", req.query.date);
      if (req.query.leagueId) params.set("leagueId", req.query.leagueId);
      if (req.query.season) params.set("season", req.query.season);
      if (req.query.countryCode) params.set("countryCode", req.query.countryCode);
      if (req.query.timezone) params.set("timezone", req.query.timezone);
      if (req.query.limit) params.set("limit", req.query.limit);
      if (req.query.offset) params.set("offset", req.query.offset);

      if (!req.query.date && !req.query.leagueId && !req.query.countryCode) {
        params.set("date", jakartaDate());
      }

      if (!params.has("timezone")) {
        params.set("timezone", "Asia/Jakarta");
      }
    }

    else if (
      ["hl-statistics", "hl-lineups", "hl-events", "hl-boxscore", "hl-match"].includes(type)
    ) {
      const id = req.query.id;
      if (!id) {
        return res.status(400).json({ error: "Parameter id wajib diisi." });
      }

      const endpoints = {
        "hl-statistics": "statistics",
        "hl-lineups": "lineups",
        "hl-events": "events",
        "hl-boxscore": "box-score",
        "hl-match": "matches"
      };

      path = `/${endpoints[type]}/${encodeURIComponent(id)}`;
    }

    else if (type === "hl-h2h") {
      const team1 = req.query.team1;
      const team2 = req.query.team2;

      if (!team1 || !team2) {
        return res.status(400).json({
          error: "Parameter team1 dan team2 wajib diisi."
        });
      }

      path = "/head-2-head";
      params.set("teamIdOne", team1);
      params.set("teamIdTwo", team2);
    }

    else {
      return res.status(400).json({ error: "Jenis endpoint tidak dikenal." });
    }

    const query = params.toString();
    const url = `https://soccer.highlightly.net${path}${query ? `?${query}` : ""}`;
    const cacheKey = `highlightly:${url}`;

    let data = getCached(cacheKey);
    if (data === null) {
      data = await requestJSON(url, key);
      setCached(cacheKey, data, ttl);
    }

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

    return res.status(200).json({
      provider: "Highlightly",
      type,
      data
    });
  } catch (error) {
    return sendError(res, error);
  }
}
