
const memoryCache = new Map();

const TTL = {
  leagues: 6 * 60 * 60 * 1000,
  matches: 60 * 1000,
  details: 5 * 60 * 1000
};

function getCache(key) {
  const item = memoryCache.get(key);

  if (!item || Date.now() > item.expires) {
    memoryCache.delete(key);
    return null;
  }

  return item.data;
}

function saveCache(key, data, ttl) {
  memoryCache.set(key, {
    data,
    expires: Date.now() + ttl
  });
}

async function requestJSON(url, headers = {}) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000)
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(
      data?.message || `Provider error ${response.status}`
    );

    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function cachedRequest(key, ttl, request) {
  const cached = getCache(key);

  if (cached !== null) return cached;

  const data = await request();
  saveCache(key, data, ttl);

  return data;
}

function getJakartaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function sendError(res, error) {
  console.error("FOOTBALL API ERROR:", error);

  return res.status(error.status || 500).json({
    error: "Gagal mengambil data sepak bola",
    message: error.message,
    providerError: error.data || null
  });
}

export default async function handler(req, res) {
  const type = String(req.query.type || "");
  const source = String(req.query.source || "highlightly");

  try {
    if (source === "highlightly") {
      const key = process.env.HIGHLIGHTLY_API_KEY;

      if (!key) {
        return res.status(500).json({
          error: "HIGHLIGHTLY_API_KEY belum dipasang di Vercel"
        });
      }

      const params = new URLSearchParams();
      let path = "";
      let ttl = TTL.details;

      if (type === "hl-leagues") {
        path = "/leagues";
        ttl = TTL.leagues;

        if (req.query.season) {
          params.set("season", req.query.season);
        }

        if (req.query.countryCode) {
          params.set("countryCode", req.query.countryCode);
        }
      }

      else if (type === "hl-matches") {
        path = "/matches";
        ttl = TTL.matches;

        params.set("date", req.query.date || getJakartaDate());

        if (req.query.leagueId) {
          params.set("leagueId", req.query.leagueId);
        }

        if (req.query.countryCode) {
          params.set("countryCode", req.query.countryCode);
        }

        if (req.query.limit) {
          params.set("limit", req.query.limit);
        }
      }

      else if (
        ["hl-statistics", "hl-lineups", "hl-events"].includes(type)
      ) {
        const id = req.query.id;

        if (!id) {
          return res.status(400).json({
            error: "Parameter id wajib diisi"
          });
        }

        const endpoint = {
          "hl-statistics": "statistics",
          "hl-lineups": "lineups",
          "hl-events": "events"
        }[type];

        path = `/${endpoint}/${encodeURIComponent(id)}`;
      }

      else if (type === "hl-h2h") {
        const team1 = req.query.team1;
        const team2 = req.query.team2;

        if (!team1 || !team2) {
          return res.status(400).json({
            error: "Parameter team1 dan team2 wajib diisi"
          });
        }

        path = "/head-2-head";

        params.set("teamIdOne", team1);
        params.set("teamIdTwo", team2);
      }

      else {
        return res.status(400).json({
          error: "Jenis Highlightly tidak valid"
        });
      }

      const url =
        `https://soccer.highlightly.net${path}` +
        (params.toString() ? `?${params.toString()}` : "");

      const data = await cachedRequest(
        `highlightly:${url}`,
        ttl,
        () => requestJSON(url, {
          "x-rapidapi-key": key
        })
      );

      res.setHeader(
        "Cache-Control",
        "s-maxage=30, stale-while-revalidate=60"
      );

      return res.status(200).json({
        provider: "Highlightly",
        type,
        data
      });
    }

    return res.status(400).json({
      error: "Gunakan source=highlightly"
    });

  } catch (error) {
    return sendError(res, error);
  }
}
