
const APISPORTS = "https://v3.football.api-sports.io";
const FOOTYSTATS = "https://api.football-data-api.com";

const cache = new Map();

const TTL = {
  live: 15000,
  home: 30000,
  matches: 60000,
  leagues: 3600000,
  standings: 300000,
  detail: 30000,
  h2h: 300000,
  footy: 300000
};

function send(res, status, body) {
  return res.status(status).json(body);
}

async function request(url, headers = {}, ttl = 30000) {
  const key = url.toString();
  const cached = cache.get(key);

  if (cached && Date.now() - cached.time < ttl) {
    return cached.data;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.errors?.requests ||
      `API error ${response.status}`
    );
  }

  if (data.errors && Object.keys(data.errors).length) {
    throw new Error(JSON.stringify(data.errors));
  }

  cache.set(key, { time: Date.now(), data });
  return data;
}

// API-FOOTBALL
async function apiSports(path, params = {}) {
  const key = process.env.API_FOOTBALL_KEY;

  if (!key) throw new Error("API_FOOTBALL_KEY belum diatur.");

  const url = new URL(APISPORTS + path);

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  });

  let ttl = TTL.matches;

  if (params.live === "all") ttl = TTL.live;
  if (path.includes("standings")) ttl = TTL.standings;
  if (path.includes("leagues")) ttl = TTL.leagues;
  if (path.includes("headtohead")) ttl = TTL.h2h;
  if (params.id) ttl = TTL.detail;

  return request(
    url,
    { "x-apisports-key": key },
    ttl
  );
}

// FOOTYSTATS
async function footyStats(endpoint, params = {}) {
  const key = process.env.FOOTYSTATS_API_KEY;

  if (!key) throw new Error("FOOTYSTATS_API_KEY belum diatur.");

  const url = new URL(FOOTYSTATS + endpoint);

  // FootyStats menggunakan key sebagai query parameter.
  // Request ini hanya dilakukan dari backend Vercel.
  url.searchParams.set("key", key);

  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  });

  return request(url, {}, TTL.footy);
}

function getToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function extractFooty(data) {
  return data?.data ?? data?.response ?? data;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return send(res, 405, {
      ok: false,
      error: "Method tidak didukung."
    });
  }

  try {
    const q = req.query || {};
    const type = q.type || "home";
    const season = Number(q.season) || new Date().getUTCFullYear();

    let result;

    // GABUNGAN KEDUA API
    if (type === "home") {
      const today = getToday();

      const [live, todayMatches, upcoming] = await Promise.all([
        apiSports("/fixtures", {
          live: "all",
          timezone: "Asia/Jakarta"
        }),
        apiSports("/fixtures", {
          date: today,
          timezone: "Asia/Jakarta"
        }),
        apiSports("/fixtures", {
          next: 20,
          timezone: "Asia/Jakarta"
        })
      ]);

      let footy = [];
      let footyError = null;

      if (process.env.FOOTYSTATS_API_KEY) {
        try {
          const data = await footyStats("/todays-matches", {
            date: today,
            timezone: "Asia/Jakarta"
          });

          footy = extractFooty(data);
        } catch (error) {
          footyError = error.message;
        }
      }

      result = {
        live: live.response || [],
        today: todayMatches.response || [],
        upcoming: upcoming.response || [],
        footystats: Array.isArray(footy) ? footy : [],
        footystatsError: footyError
      };
    }

    // API-FOOTBALL: MATCHES
    else if (type === "matches") {
      const data = await apiSports("/fixtures", {
        date: q.date || getToday(),
        timezone: "Asia/Jakarta",
        league: q.league,
        season
      });

      result = data.response || [];
    }

    // API-FOOTBALL: LEAGUES
    else if (type === "leagues") {
      const data = await apiSports("/leagues", {
        season,
        current: "true"
      });

      result = data.response || [];
    }

    // API-FOOTBALL: STANDINGS
    else if (type === "standings") {
      if (!q.league) {
        return send(res, 400, {
          ok: false,
          error: "ID liga diperlukan."
        });
      }

      const data = await apiSports("/standings", {
        league: q.league,
        season
      });

      result = data.response || [];
    }

    // API-FOOTBALL: DETAIL
    else if (type === "detail") {
      if (!q.fixture) {
        return send(res, 400, {
          ok: false,
          error: "ID pertandingan diperlukan."
        });
      }

      const data = await apiSports("/fixtures", {
        id: q.fixture
      });

      result = data.response?.[0] || null;
    }

    // API-FOOTBALL: H2H
    else if (type === "h2h") {
      if (!q.home || !q.away) {
        return send(res, 400, {
          ok: false,
          error: "ID kedua tim diperlukan."
        });
      }

      const data = await apiSports("/fixtures/headtohead", {
        h2h: `${q.home}-${q.away}`,
        last: 10,
        timezone: "Asia/Jakarta"
      });

      result = data.response || [];
    }

    // FOOTYSTATS: LEAGUES
    else if (type === "footy-leagues") {
      const data = await footyStats("/league-list", {
        chosen_leagues_only: "true"
      });

      result = extractFooty(data);
    }

    // FOOTYSTATS: TODAY MATCHES
    else if (type === "footy-today") {
      const data = await footyStats("/todays-matches", {
        date: q.date || getToday(),
        timezone: "Asia/Jakarta",
        page: q.page || 1
      });

      result = extractFooty(data);
    }

    // FOOTYSTATS: MATCH DETAIL + H2H + LINEUPS
    else if (type === "footy-match") {
      if (!q.match_id) {
        return send(res, 400, {
          ok: false,
          error: "FootyStats match_id diperlukan."
        });
      }

      const data = await footyStats("/match", {
        match_id: q.match_id
      });

      result = extractFooty(data);
    }

    else {
      return send(res, 400, {
        ok: false,
        error: "Tipe data tidak dikenal."
      });
    }

    return send(res, 200, {
      ok: true,
      provider: type.startsWith("footy")
        ? "FootyStats"
        : type === "home"
          ? "API-Football + FootyStats"
          : "API-Football",
      data: result
    });

  } catch (error) {
    console.error("Football API:", error);

    return send(res, 500, {
      ok: false,
      error: error.message || "Gagal mengambil data."
    });
  }
}
