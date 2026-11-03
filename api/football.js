"use strict";

const BASE = "https://v3.football.api-sports.io";
const OPENFOOTBALL =
  "https://raw.githubusercontent.com/openfootball/football.json/master";

const cache = new Map();
const TTL = {
  live: 25 * 1000,
  fixtures: 3 * 60 * 1000,
  detail: 2 * 60 * 1000,
  lineups: 5 * 60 * 1000,
  standings: 30 * 60 * 1000,
  leagues: 6 * 60 * 60 * 1000,
  history: 30 * 60 * 1000,
  open: 6 * 60 * 60 * 1000
};

const OPEN_LEAGUES = [
  { id: 39, name: "Premier League", country: "England", file: "en.1" },
  { id: 40, name: "Championship", country: "England", file: "en.2" },
  { id: 78, name: "Bundesliga", country: "Germany", file: "de.1" },
  { id: 79, name: "2. Bundesliga", country: "Germany", file: "de.2" },
  { id: 140, name: "La Liga", country: "Spain", file: "es.1" },
  { id: 135, name: "Serie A", country: "Italy", file: "it.1" },
  { id: 61, name: "Ligue 1", country: "France", file: "fr.1" },
  { id: 253, name: "MLS", country: "USA", file: "us.1" }
];

function send(res, status, body) {
  res.status(status).json(body);
}

function getCache(key) {
  const item = cache.get(key);
  if (!item) return null;

  if (Date.now() > item.expires) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function setCache(key, value, ttl) {
  cache.set(key, {
    value,
    expires: Date.now() + ttl
  });
  return value;
}

async function fetchJSON(url, headers = {}) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000)
  });

  const text = await response.text();
  let json;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Provider mengirim respons yang tidak valid.");
  }

  if (!response.ok) {
    throw new Error(
      json?.message ||
      json?.errors?.token ||
      json?.errors?.requests ||
      `Provider HTTP ${response.status}`
    );
  }

  return json;
}

async function football(path, params = {}, ttl = TTL.detail) {
  const key = "api:" + path + ":" + JSON.stringify(params);
  const cached = getCache(key);
  if (cached) return cached;

  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    throw new Error("Environment variable API_FOOTBALL_KEY belum diatur.");
  }

  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  });

  const json = await fetchJSON(url.toString(), {
    "x-apisports-key": apiKey
  });

  if (json.errors && Object.keys(json.errors).length) {
    throw new Error(JSON.stringify(json.errors));
  }

  return setCache(key, json.response ?? [], ttl);
}

function seasonForDate(date) {
  const d = new Date(`${date || new Date().toISOString().slice(0, 10)}T12:00:00Z`);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  return month >= 7 ? year : year - 1;
}

function statusGroup(short = "") {
  if (["1H", "2H", "HT", "ET", "BT", "P", "LIVE"].includes(short)) {
    return "live";
  }
  if (["FT", "AET", "PEN"].includes(short)) return "finished";
  if (["NS", "TBD"].includes(short)) return "upcoming";
  if (["PST", "CANC", "ABD", "AWD", "WO"].includes(short)) {
    return "postponed";
  }
  return "upcoming";
}

function mapFixture(item) {
  const f = item.fixture || {};
  const league = item.league || {};
  const home = item.teams?.home || {};
  const away = item.teams?.away || {};
  const status = f.status || {};

  return {
    fixture: {
      id: f.id,
      date: f.date,
      timestamp: f.timestamp,
      venue: {
        name: f.venue?.name || null,
        city: f.venue?.city || null
      },
      status: {
        short: status.short || "NS",
        long: status.long || "Not started",
        elapsed: status.elapsed ?? null,
        extra: status.extra ?? null
      }
    },
    league: {
      id: league.id,
      name: league.name || "Unknown League",
      country: league.country || "",
      logo: league.logo || null,
      flag: league.flag || null,
      season: league.season
    },
    teams: {
      home: {
        id: home.id,
        name: home.name || "Home",
        logo: home.logo || null,
        winner: home.winner ?? null
      },
      away: {
        id: away.id,
        name: away.name || "Away",
        logo: away.logo || null,
        winner: away.winner ?? null
      }
    },
    goals: {
      home: item.goals?.home ?? null,
      away: item.goals?.away ?? null
    },
    score: item.score || {},
    statusGroup: statusGroup(status.short),
    source: "API-Football"
  };
}

function mapOpenFootballMatch(match, league) {
  const score = match.score?.ft || match.score?.pen || [];
  const date = match.date ? new Date(match.date + "T12:00:00Z") : null;

  return {
    fixture: {
      id: `open-${league.file}-${match.date}-${match.team1}-${match.team2}`,
      date: date ? date.toISOString() : null,
      timestamp: date ? Math.floor(date.getTime() / 1000) : null,
      venue: { name: null, city: null },
      status: {
        short: score.length ? "FT" : "NS",
        long: score.length ? "Match Finished" : "Not started",
        elapsed: null
      }
    },
    league: {
      id: league.id,
      name: league.name,
      country: league.country,
      logo: null,
      season: seasonForDate(match.date)
    },
    teams: {
      home: { id: null, name: match.team1, logo: null },
      away: { id: null, name: match.team2, logo: null }
    },
    goals: {
      home: score.length ? Number(score[0]) : null,
      away: score.length ? Number(score[1]) : null
    },
    statusGroup: score.length ? "finished" : "upcoming",
    source: "OpenFootball"
  };
}

async function openFootballMatches(date) {
  const year = seasonForDate(date);
  const season = `${year}-${String(year + 1).slice(-2)}`;
  const key = `open:${season}:${date}`;

  const cached = getCache(key);
  if (cached) return cached;

  const results = await Promise.allSettled(
    OPEN_LEAGUES.map(async league => {
      const url = `${OPENFOOTBALL}/${season}/${league.file}.json`;
      const json = await fetchJSON(url);
      const matches = Array.isArray(json.matches) ? json.matches : [];

      return matches
        .filter(m => m.date === date)
        .map(m => mapOpenFootballMatch(m, league));
    })
  );

  const matches = results
    .filter(x => x.status === "fulfilled")
    .flatMap(x => x.value);

  return setCache(key, matches, TTL.open);
}

async function getMatches(params) {
  const date = params.date || new Date().toISOString().slice(0, 10);
  const apiParams = {
    date,
    timezone: params.timezone || "Asia/Jakarta"
  };

  if (params.leagueId) apiParams.league = params.leagueId;
  if (params.season) apiParams.season = params.season;

  try {
    const data = await football(
      "/fixtures",
      apiParams,
      TTL.fixtures
    );
    return {
      data: data.map(mapFixture),
      provider: "API-Football",
      fallback: false
    };
  } catch (error) {
    const fallback = await openFootballMatches(date);
    if (params.leagueId) {
      return {
        data: fallback.filter(
          m => String(m.league.id) === String(params.leagueId)
        ),
        provider: "OpenFootball",
        fallback: true,
        warning: error.message
      };
    }

    return {
      data: fallback,
      provider: "OpenFootball",
      fallback: true,
      warning: error.message
    };
  }
}

async function getLeagues() {
  try {
    const data = await football(
      "/leagues",
      { current: "true" },
      TTL.leagues
    );

    return {
      data: data.map(x => ({
        league: x.league,
        country: x.country,
        seasons: x.seasons || [],
        coverage: x.seasons?.find(s => s.current)?.coverage || {}
      })),
      provider: "API-Football"
    };
  } catch (error) {
    return {
      data: OPEN_LEAGUES.map(l => ({
        league: {
          id: l.id,
          name: l.name,
          logo: null,
          type: "League"
        },
        country: { name: l.country },
        seasons: [],
        coverage: {}
      })),
      provider: "OpenFootball",
      warning: error.message
    };
  }
}

async function getFixture(id) {
  const data = await football("/fixtures", { id }, TTL.detail);
  return data[0] || null;
}

async function getLineups(id, fixture) {
  const data = await football(
    "/fixtures/lineups",
    { fixture: id },
    TTL.lineups
  );

  if (data.length >= 2) {
    return {
      mode: "official",
      available: true,
      teams: data.map(t => ({
        team: t.team,
        formation: t.formation,
        coach: t.coach,
        startXI: t.startXI || [],
        substitutes: t.substitutes || []
      }))
    };
  }

  // Jika lineup resmi belum keluar, coba ambil lineup pertandingan
  // terakhir masing-masing tim. Ini hanya perkiraan, bukan konfirmasi.
  if (!fixture) fixture = await getFixture(id);
  if (!fixture) {
    return { mode: "unavailable", available: false, teams: [] };
  }

  const teamIds = [
    fixture.teams?.home?.id,
    fixture.teams?.away?.id
  ].filter(Boolean);

  const guesses = await Promise.allSettled(
    teamIds.map(async teamId => {
      const recent = await football(
        "/fixtures",
        {
          team: teamId,
          last: 1,
          season: fixture.league?.season
        },
        TTL.history
      );

      const last = recent[0];
      if (!last?.fixture?.id) return null;

      const lastLineups = await football(
        "/fixtures/lineups",
        { fixture: last.fixture.id },
        TTL.lineups
      );

      return lastLineups.find(
        x => String(x.team?.id) === String(teamId)
      ) || null;
    })
  );

  const teams = guesses
    .filter(x => x.status === "fulfilled" && x.value)
    .map(x => ({
      team: x.value.team,
      formation: x.value.formation,
      coach: x.value.coach,
      startXI: x.value.startXI || [],
      substitutes: x.value.substitutes || []
    }));

  return {
    mode: teams.length ? "estimated" : "unavailable",
    available: teams.length > 0,
    teams,
    note: teams.length
      ? "Perkiraan berdasarkan susunan pertandingan terakhir, bukan lineup resmi."
      : "Lineup resmi belum tersedia dan data perkiraan tidak ditemukan."
  };
}

async function getMatchDetails(id) {
  const fixture = await getFixture(id);
  if (!fixture) throw new Error("Pertandingan tidak ditemukan.");

  const mapped = mapFixture(fixture);

  const [lineups, statistics, players, events] =
    await Promise.allSettled([
      getLineups(id, fixture),
      football("/fixtures/statistics", { fixture: id }, TTL.detail),
      football("/fixtures/players", { fixture: id }, TTL.detail),
      football("/fixtures/events", { fixture: id }, TTL.detail)
    ]);

  return {
    match: mapped,
    lineups: lineups.status === "fulfilled"
      ? lineups.value
      : { mode: "unavailable", available: false, teams: [] },
    statistics: statistics.status === "fulfilled"
      ? statistics.value
      : [],
    players: players.status === "fulfilled"
      ? players.value
      : [],
    events: events.status === "fulfilled"
      ? events.value
      : []
  };
}

async function getH2H(team1, team2, last = 10) {
  const data = await football(
    "/fixtures/headtohead",
    { h2h: `${team1}-${team2}`, last },
    TTL.history
  );
  return data.map(mapFixture);
}

async function getTeamForm(team, last = 5, season) {
  const params = { team, last };
  if (season) params.season = season;

  const data = await football("/fixtures", params, TTL.history);
  return data.map(mapFixture);
}

async function getStandings(league, season) {
  const data = await football(
    "/standings",
    { league, season },
    TTL.standings
  );

  return data;
}

async function getPredictions(fixture) {
  const data = await football(
    "/predictions",
    { fixture },
    TTL.history
  );

  return data[0] || null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return send(res, 405, { error: "Method not allowed" });
  }

  const q = req.query || {};
  const type = q.type;

  try {
    let result;

    switch (type) {
      case "leagues":
      case "hl-leagues":
        result = await getLeagues();
        break;

      case "matches":
      case "hl-matches":
        result = await getMatches(q);
        break;

      case "match":
      case "hl-match":
        if (String(q.id).startsWith("open-")) {
          throw new Error("Detail pertandingan OpenFootball tidak menyediakan data live.");
        }
        result = await getMatchDetails(q.id);
        break;

      case "statistics":
      case "hl-statistics":
        result = await football(
          "/fixtures/statistics",
          { fixture: q.id },
          TTL.detail
        );
        break;

      case "lineups":
      case "hl-lineups":
        result = await getLineups(q.id);
        break;

      case "players":
      case "hl-boxscore":
        result = await football(
          "/fixtures/players",
          { fixture: q.id },
          TTL.detail
        );
        break;

      case "events":
      case "hl-events":
        result = await football(
          "/fixtures/events",
          { fixture: q.id },
          TTL.detail
        );
        break;

      case "h2h":
      case "hl-h2h":
        result = await getH2H(q.team1, q.team2, q.last || 10);
        break;

      case "team-form":
        result = await getTeamForm(
          q.team,
          q.last || 5,
          q.season
        );
        break;

      case "standings":
        result = await getStandings(q.league, q.season);
        break;

      case "predictions":
        result = await getPredictions(q.fixture);
        break;

      default:
        return send(res, 400, {
          error: "Tipe endpoint tidak dikenal.",
          supported: [
            "leagues", "matches", "match", "statistics",
            "lineups", "players", "events", "h2h",
            "team-form", "standings", "predictions"
          ]
        });
    }

    return send(res, 200, {
      provider: "API-Football + OpenFootball",
      type,
      data: result
    });

  } catch (error) {
    console.error("[Football Forum]", error);

    return send(res, 500, {
      error: error.message || "Terjadi kesalahan pada server."
    });
  }
};
