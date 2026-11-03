
"use strict";

const API = "https://v3.football.api-sports.io";
const cache = new Map();

const LEAGUES = [
  { id: 2, name: "UEFA Champions League", country: "Europe", flag: "🇪🇺" },
  { id: 3, name: "UEFA Europa League", country: "Europe", flag: "🇪🇺" },
  { id: 848, name: "UEFA Conference League", country: "Europe", flag: "🇪🇺" },
  { id: 39, name: "Premier League", country: "England", flag: "🇬🇧" },
  { id: 40, name: "Championship", country: "England", flag: "🇬🇧" },
  { id: 140, name: "La Liga", country: "Spain", flag: "🇪🇸" },
  { id: 135, name: "Serie A", country: "Italy", flag: "🇮🇹" },
  { id: 78, name: "Bundesliga", country: "Germany", flag: "🇩🇪" },
  { id: 61, name: "Ligue 1", country: "France", flag: "🇫🇷" },
  { id: 88, name: "Eredivisie", country: "Netherlands", flag: "🇳🇱" },
  { id: 94, name: "Primeira Liga", country: "Portugal", flag: "🇵🇹" },
  { id: 71, name: "Brasileirão Série A", country: "Brazil", flag: "🇧🇷" },
  { id: 253, name: "MLS", country: "USA", flag: "🇺🇸" },
  { id: 128, name: "Liga 1", country: "Indonesia", flag: "🇮🇩" },
  { id: 239, name: "Primera División", country: "Argentina", flag: "🇦🇷" }
];

function jakartaDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const obj = {};
  parts.forEach(p => obj[p.type] = p.value);
  return `${obj.year}-${obj.month}-${obj.day}`;
}

function seasonForDate(date) {
  const d = new Date(`${date}T12:00:00+07:00`);
  return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
}

function cached(key) {
  const item = cache.get(key);
  if (!item || item.expiry < Date.now()) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function saveCache(key, value, seconds = 60) {
  cache.set(key, {
    value,
    expiry: Date.now() + seconds * 1000
  });
  return value;
}

async function request(path, params = {}, ttl = 60) {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw new Error("API_FOOTBALL_KEY belum diatur di Vercel");

  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      query.set(k, String(v));
    }
  });

  const url = `${API}${path}?${query.toString()}`;
  const key = `af:${url}`;
  const old = cached(key);
  if (old) return old;

  const response = await fetch(url, {
    headers: { "x-apisports-key": apiKey }
  });

  const json = await response.json();

  if (!response.ok) {
    throw new Error(json.message || `API-Football HTTP ${response.status}`);
  }

  if (json.errors && Object.keys(json.errors).length) {
    throw new Error(JSON.stringify(json.errors));
  }

  return saveCache(key, json.response || [], ttl);
}

function normalizeFixture(item) {
  const f = item.fixture || {};
  const teams = item.teams || {};
  const league = item.league || {};
  const goals = item.goals || {};
  const status = f.status || {};
  const short = status.short || "NS";

  return {
    id: String(f.id || ""),
    providerId: String(f.id || ""),
    provider: "API-Football",
    date: f.date || null,
    timeKnown: Boolean(f.date),
    statusShort: short,
    status: status.long || short,
    live: ["1H", "2H", "HT", "ET", "P", "LIVE", "INT"].includes(short),
    finished: ["FT", "AET", "PEN"].includes(short),
    elapsed: status.elapsed ?? null,

    home: teams.home?.name || "Home",
    away: teams.away?.name || "Away",
    homeId: teams.home?.id ?? null,
    awayId: teams.away?.id ?? null,
    homeLogo: teams.home?.logo || "",
    awayLogo: teams.away?.logo || "",

    homeScore: goals.home ?? null,
    awayScore: goals.away ?? null,

    league: league.name || "Unknown League",
    leagueId: league.id ?? null,
    leagueLogo: league.logo || "",
    country: league.country || "International",
    season: league.season ?? null,
    round: league.round || "",
    venue: f.venue?.name || "",
    referee: f.referee || ""
  };
}

async function fixtures(params) {
  const rows = await request("/fixtures", {
    timezone: "Asia/Jakarta",
    ...params
  }, 45);

  return rows.map(normalizeFixture);
}

async function getLeagues() {
  const rows = await request("/leagues", { current: "true" }, 3600);

  const result = new Map();

  for (const item of rows) {
    const l = item.league || {};
    const season = (item.seasons || []).find(s => s.current);
    if (!l.id) continue;

    result.set(String(l.id), {
      id: l.id,
      name: l.name || "Unknown",
      country: l.country || "International",
      logo: l.logo || "",
      flag: l.flag || "",
      season: season?.year || seasonForDate(jakartaDate())
    });
  }

  // Keep requested popular competitions available even if the
  // provider's current-league response does not include them.
  for (const l of LEAGUES) {
    const old = result.get(String(l.id));
    if (!old) {
      result.set(String(l.id), {
        ...l,
        logo: "",
        season: seasonForDate(jakartaDate())
      });
    }
  }

  return [...result.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

async function getMatch(id) {
  if (!/^\d+$/.test(String(id || ""))) {
    throw new Error("ID pertandingan API-Football tidak valid");
  }

  const base = await request("/fixtures", { id }, 90);
  if (!base.length) throw new Error("Pertandingan tidak ditemukan");

  const [stats, lineups, players, events] = await Promise.allSettled([
    request("/fixtures/statistics", { fixture: id }, 90),
    request("/fixtures/lineups", { fixture: id }, 90),
    request("/fixtures/players", { fixture: id }, 90),
    request("/fixtures/events", { fixture: id }, 45)
  ]);

  const value = r => r.status === "fulfilled" ? r.value : [];

  return {
    fixture: normalizeFixture(base[0]),
    statistics: value(stats),
    lineups: value(lineups),
    players: value(players),
    events: value(events),
    unavailable: [
      stats, lineups, players, events
    ].map((r, i) => r.status === "rejected"
      ? ["statistics", "lineups", "players", "events"][i]
      : null
    ).filter(Boolean)
  };
}

async function getStandings(league, season) {
  const rows = await request("/standings", {
    league,
    season: season || seasonForDate(jakartaDate())
  }, 900);

  return rows[0]?.league?.standings || [];
}

async function getH2H(team1, team2) {
  if (!team1 || !team2) return [];

  return fixtures({
    h2h: `${team1}-${team2}`,
    last: 10
  });
}

async function getPredictions(fixture) {
  const rows = await request("/predictions", { fixture }, 300);
  return rows[0] || null;
}

async function route(type, q) {
  const date = q.date || jakartaDate();

  switch (type) {
    case "home": {
      const [matches, leagues] = await Promise.all([
        fixtures({ date }),
        getLeagues()
      ]);

      return {
        date,
        matches,
        leagues,
        live: matches.filter(m => m.live),
        posters: matches.slice(0, 5)
      };
    }

    case "leagues":
    case "hl-leagues":
      return getLeagues();

    case "matches":
    case "hl-matches": {
      const league = q.league || q.leagueId;
      const season = q.season || seasonForDate(date);

      return fixtures({
        date,
        league: league || undefined,
        season: league ? season : undefined
      });
    }

    case "match":
    case "hl-match":
      return getMatch(q.id);

    case "statistics":
    case "hl-statistics":
      return (await getMatch(q.id)).statistics;

    case "lineups":
    case "hl-lineups":
      return (await getMatch(q.id)).lineups;

    case "players":
    case "ratings":
    case "hl-boxscore":
      return (await getMatch(q.id)).players;

    case "events":
    case "timeline":
      return (await getMatch(q.id)).events;

    case "standings":
      return getStandings(q.league, q.season);

    case "h2h":
    case "hl-h2h":
      return getH2H(q.team1, q.team2);

    case "predictions":
      return getPredictions(q.fixture);

    case "team-form": {
      const rows = await fixtures({
        team: q.team,
        last: 5,
        season: q.season || undefined
      });
      return rows;
    }

    default:
      throw new Error(`Jenis permintaan tidak dikenal: ${type}`);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const data = await route(req.query?.type || "home", req.query || {});

    return res.status(200).json({
      ok: true,
      data
    });
  } catch (error) {
    console.error("Football Forum API:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Server error"
    });
  }
};
