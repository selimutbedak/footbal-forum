const APIFOOTBALL = "https://v3.football.api-sports.io";
const FOOTYSTATS = "https://api.football-data-api.com";

const cache = new Map();

const TTL = {
  live: 15000,
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

function cached(key, ttl) {
  const item = cache.get(key);
  if (item && Date.now() - item.time < ttl) return item.data;
  return null;
}

function saveCache(key, data) {
  cache.set(key, { time: Date.now(), data });
  return data;
}

async function apiFootball(path, params = {}) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("API_FOOTBALL_KEY belum diatur di Vercel.");

  const url = new URL(APIFOOTBALL + path);

  Object.entries(params).forEach(([name, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(name, String(value));
    }
  });

  const cacheKey = url.toString();
  const ttl = path.includes("headtohead")
    ? TTL.h2h
    : path.includes("standings")
      ? TTL.standings
      : path.includes("leagues")
        ? TTL.leagues
        : path.includes("fixtures")
          ? TTL.detail
          : TTL.matches;

  const old = cached(cacheKey, ttl);
  if (old) return old;

  const response = await fetch(url, {
    headers: { "x-apisports-key": key }
  });

  const data = await response.json();

  if (!response.ok || (data.errors && Object.keys(data.errors).length)) {
    throw new Error(JSON.stringify(data.errors || `API-Football error ${response.status}`));
  }

  return saveCache(cacheKey, data);
}

async function footyStats(endpoint, params = {}) {
  const key = process.env.FOOTYSTATS_API_KEY;
  if (!key) throw new Error("FOOTYSTATS_API_KEY belum diatur di Vercel.");

  const url = new URL(FOOTYSTATS + endpoint);
  url.searchParams.set("key", key);

  Object.entries(params).forEach(([name, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(name, String(value));
    }
  });

  const cacheKey = url.toString();
  const old = cached(cacheKey, TTL.footy);
  if (old) return old;

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.success === false) {
    throw new Error(data.message || `FootyStats error ${response.status}`);
  }

  return saveCache(cacheKey, data);
}

function jakartaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function normalizeName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getFootyTeamName(match, side) {
  const names = side === "home"
    ? ["home_name", "homeName", "home_team_name", "homeTeam"]
    : ["away_name", "awayName", "away_team_name", "awayTeam"];

  for (const name of names) {
    if (typeof match[name] === "string") return match[name];
    if (match[name] && typeof match[name].name === "string") {
      return match[name].name;
    }
  }

  return "";
}

async function findFootyMatch(fixture) {
  if (!fixture?.fixture?.date || !fixture?.teams) return null;

  const date = fixture.fixture.date.slice(0, 10);

  const result = await footyStats("/todays-matches", {
    date,
    timezone: "Asia/Jakarta"
  });

  const matches = Array.isArray(result.data) ? result.data : [];

  const home = normalizeName(fixture.teams.home.name);
  const away = normalizeName(fixture.teams.away.name);

  const found = matches.find(match => {
    const footyHome = normalizeName(getFootyTeamName(match, "home"));
    const footyAway = normalizeName(getFootyTeamName(match, "away"));

    return footyHome && footyAway &&
      footyHome === home &&
      footyAway === away;
  });

  if (!found?.id) return null;

  const detail = await footyStats("/match", {
    match_id: found.id
  });

  return Array.isArray(detail.data) ? detail.data[0] : detail.data || null;
}

function seasonNow() {
  const now = new Date();
  return now.getUTCMonth() >= 6
    ? now.getUTCFullYear()
    : now.getUTCFullYear() - 1;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return send(res, 405, { ok: false, error: "Method tidak didukung." });
  }

  try {
    const q = req.query || {};
    const type = q.type || "home";
    const season = Number(q.season) || seasonNow();

    let result;

    if (type === "home") {
      const today = jakartaDate();

      const [live, todayMatches, upcoming] = await Promise.all([
        apiFootball("/fixtures", {
          live: "all",
          timezone: "Asia/Jakarta"
        }),
        apiFootball("/fixtures", {
          date: today,
          timezone: "Asia/Jakarta"
        }),
        apiFootball("/fixtures", {
          next: 20,
          timezone: "Asia/Jakarta"
        })
      ]);

      result = {
        live: live.response || [],
        today: todayMatches.response || [],
        upcoming: upcoming.response || []
      };
    }

    else if (type === "matches") {
      const data = await apiFootball("/fixtures", {
        date: q.date || jakartaDate(),
        timezone: "Asia/Jakarta",
        league: q.league || undefined,
        season
      });

      result = data.response || [];
    }

    else if (type === "leagues") {
      const data = await apiFootball("/leagues", {
        season,
        current: "true"
      });

      result = data.response || [];
    }

    else if (type === "standings") {
      if (!q.league) {
        return send(res, 400, { ok: false, error: "ID liga belum diberikan." });
      }

      const data = await apiFootball("/standings", {
        league: q.league,
        season
      });

      result = data.response || [];
    }

    else if (type === "detail") {
      if (!q.fixture) {
        return send(res, 400, { ok: false, error: "ID pertandingan belum diberikan." });
      }

      const [fixtureData, statsData, lineupsData] = await Promise.all([
        apiFootball("/fixtures", { id: q.fixture }),
        apiFootball("/fixtures/statistics", { fixture: q.fixture }),
        apiFootball("/fixtures/lineups", { fixture: q.fixture })
      ]);

      const fixture = fixtureData.response?.[0] || null;

      let footystats = null;
      if (fixture) {
        try {
          footystats = await findFootyMatch(fixture);
        } catch (error) {
          console.error("FootyStats detail:", error.message);
        }
      }

      result = fixture
        ? {
            ...fixture,
            statistics: statsData.response || [],
            lineups: lineupsData.response || [],
            footystats
          }
        : null;
    }

    else if (type === "h2h") {
      if (!q.home || !q.away) {
        return send(res, 400, {
          ok: false,
          error: "ID kedua tim diperlukan."
        });
      }

      const data = await apiFootball("/fixtures/headtohead", {
        h2h: `${q.home}-${q.away}`,
        last: 10,
        timezone: "Asia/Jakarta"
      });

      result = data.response || [];
    }

    else {
      return send(res, 400, {
        ok: false,
        error: "Tipe data tidak dikenal."
      });
    }

    return send(res, 200, { ok: true, data: result });

  } catch (error) {
    console.error("Football API error:", error);

    return send(res, 500, {
      ok: false,
      error: error.message || "Gagal mengambil data pertandingan."
    });
  }
}
