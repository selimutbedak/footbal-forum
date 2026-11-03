
"use strict";

// FOOTBALL FORUM
// Data source: Open Matchday
// No API key required.
// Scores are updated daily, NOT live.

const BASE =
  "https://raw.githubusercontent.com/oladeeayo/open-matchday/master/data";

const SEASON = "2627";
const CACHE_TTL = 6 * 60 * 60 * 1000;
const cache = new Map();

// Hanya kompetisi dengan folder yang diketahui dari repositori.
const LEAGUES = [
  {
    id: 2,
    name: "UEFA Champions League",
    country: "Europe",
    flag: "🇪🇺",
    folder: "UEFA_1_champions-league"
  },
  {
    id: 39,
    name: "Premier League",
    country: "England",
    flag: "🇬🇧",
    folder: "ENG_1_premier-league"
  },
  {
    id: 40,
    name: "Championship",
    country: "England",
    flag: "🇬🇧",
    folder: "ENG_2_championship"
  },
  {
    id: 140,
    name: "La Liga",
    country: "Spain",
    flag: "🇪🇸",
    folder: "ESP_1_la-liga"
  },
  {
    id: 135,
    name: "Serie A",
    country: "Italy",
    flag: "🇮🇹",
    folder: "ITA_1_serie-a"
  },
  {
    id: 78,
    name: "Bundesliga",
    country: "Germany",
    flag: "🇩🇪",
    folder: "GER_1_bundesliga"
  },
  {
    id: 61,
    name: "Ligue 1",
    country: "France",
    flag: "🇫🇷",
    folder: "FRA_1_ligue-1"
  },
  {
    id: 88,
    name: "Eredivisie",
    country: "Netherlands",
    flag: "🇳🇱",
    folder: "NED_1_eredivisie"
  },
  {
    id: 94,
    name: "Primeira Liga",
    country: "Portugal",
    flag: "🇵🇹",
    folder: "POR_1_primeira-liga"
  },
  {
    id: 71,
    name: "Brasileirão Série A",
    country: "Brazil",
    flag: "🇧🇷",
    folder: "BRA_1_serie-a"
  },
  {
    id: 253,
    name: "MLS",
    country: "USA",
    flag: "🇺🇸",
    folder: "USA_1_mls"
  }
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

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function cacheGet(key) {
  const item = cache.get(key);

  if (!item || item.expiry < Date.now()) {
    cache.delete(key);
    return null;
  }

  return item.value;
}

function cacheSet(key, value) {
  cache.set(key, {
    value,
    expiry: Date.now() + CACHE_TTL
  });

  return value;
}

// CSV parser: supports quoted fields and commas inside quotes.
function parseCSV(text) {
  const lines = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"' && quoted && next === '"') {
      value += '"';
      i++;
    } else if (c === '"') {
      quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && next === "\n") i++;

      row.push(value);

      if (row.some(x => x.trim() !== "")) {
        lines.push(row);
      }

      row = [];
      value = "";
    } else {
      value += c;
    }
  }

  if (value.length || row.length) {
    row.push(value);
    lines.push(row);
  }

  if (!lines.length) return [];

  const headers = lines.shift().map(x => x.trim());

  return lines.map(values => {
    const item = {};

    headers.forEach((header, i) => {
      item[header] = (values[i] || "").trim();
    });

    return item;
  });
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

async function fetchCSV(url) {
  const old = cacheGet(url);
  if (old) return old;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "FootballForum/1.0"
    }
  });

  if (!response.ok) {
    if (response.status === 404) return [];

    throw new Error(
      `Sumber data gagal diakses: HTTP ${response.status}`
    );
  }

  const text = await response.text();

  return cacheSet(url, parseCSV(text));
}

function makeId(league, date, home, away) {
  return [
    league.folder,
    date,
    slug(home),
    slug(away)
  ].join("~");
}

function normalizeMatch(row, league, finished) {
  const date = row.date || "";

  const home = row.home || "Home";
  const away = row.away || "Away";

  const homeScore = finished
    ? numberOrNull(row.ft_home)
    : null;

  const awayScore = finished
    ? numberOrNull(row.ft_away)
    : null;

  const time = row.time || "";

  // Open Matchday documents kickoff time using a fixed CET-1
  // convention. The frontend converts the ISO date to Jakarta.
  const kickoff = time
    ? `${date}T${time}:00+01:00`
    : `${date}T12:00:00+01:00`;

  const hasScore =
    homeScore !== null && awayScore !== null;

  return {
    id: makeId(league, date, home, away),
    providerId: makeId(league, date, home, away),
    provider: "Open Matchday",

    date: kickoff,
    timeKnown: Boolean(time),

    statusShort: finished ? "FT" : "NS",
    status: finished ? "Finished" : "Not started",
    live: false,
    finished: finished && hasScore,
    elapsed: null,

    home,
    away,

    // This source does not provide stable team IDs or logos.
    homeId: null,
    awayId: null,
    homeLogo: "",
    awayLogo: "",

    homeScore,
    awayScore,

    league: league.name,
    leagueId: league.id,
    leagueLogo: "",
    country: league.country,
    season: 2026,
    round: row.gw ? `Matchday ${row.gw}` : "",

    venue: "",
    referee: "",

    // Additional source data for the detail page.
    halfTimeHome: numberOrNull(row.ht_home),
    halfTimeAway: numberOrNull(row.ht_away),
    goalMinutes: row.goal_minutes || "",

    homeStats: {
      shots: numberOrNull(row.home_shots),
      shotsOnTarget: numberOrNull(row.home_shots_on_target),
      fouls: numberOrNull(row.home_fouls),
      corners: numberOrNull(row.home_corners),
      yellowCards: numberOrNull(row.home_yellow),
      redCards: numberOrNull(row.home_red)
    },

    awayStats: {
      shots: numberOrNull(row.away_shots),
      shotsOnTarget: numberOrNull(row.away_shots_on_target),
      fouls: numberOrNull(row.away_fouls),
      corners: numberOrNull(row.away_corners),
      yellowCards: numberOrNull(row.away_yellow),
      redCards: numberOrNull(row.away_red)
    }
  };
}

async function getLeagueMatches(league) {
  const folder = league.folder;

  const resultsURL =
    `${BASE}/${folder}/results_${SEASON}.csv`;

  const fixturesURL =
    `${BASE}/${folder}/fixtures_${SEASON}.csv`;

  const [results, fixtures] = await Promise.all([
    fetchCSV(resultsURL),
    fetchCSV(fixturesURL)
  ]);

  const resultRows = results.map(row =>
    normalizeMatch(row, league, true)
  );

  const fixtureRows = fixtures.map(row =>
    normalizeMatch(row, league, false)
  );

  const combined = new Map();

  [...resultRows, ...fixtureRows].forEach(match => {
    combined.set(match.id, match);
  });

  return [...combined.values()];
}

async function getAllMatches() {
  const key = "all-matches";

  const old = cacheGet(key);
  if (old) return old;

  const results = await Promise.all(
    LEAGUES.map(async league => {
      try {
        return await getLeagueMatches(league);
      } catch (error) {
        console.error(
          `League ${league.name}:`,
          error.message
        );

        return [];
      }
    })
  );

  const all = results.flat();

  all.sort((a, b) =>
    new Date(a.date) - new Date(b.date)
  );

  return cacheSet(key, all);
}

function findLeague(id) {
  return LEAGUES.find(
    league => String(league.id) === String(id)
  );
}

function getLeagues() {
  return LEAGUES.map(league => ({
    id: league.id,
    name: league.name,
    country: league.country,
    flag: league.flag,
    logo: "",
    season: 2026
  }));
}

function getStatistics(match) {
  const labels = {
    shots: "Total Shots",
    shotsOnTarget: "Shots on Target",
    fouls: "Fouls",
    corners: "Corner Kicks",
    yellowCards: "Yellow Cards",
    redCards: "Red Cards"
  };

  const home = [];
  const away = [];

  Object.entries(labels).forEach(([key, label]) => {
    const h = match.homeStats[key];
    const a = match.awayStats[key];

    if (h !== null || a !== null) {
      home.push({
        type: label,
        value: h
      });

      away.push({
        type: label,
        value: a
      });
    }
  });

  if (!home.length) return [];

  return [
    { team: { name: match.home }, statistics: home },
    { team: { name: match.away }, statistics: away }
  ];
}

function getMatchDetail(match) {
  return {
    fixture: match,
    statistics: getStatistics(match),

    // Not supplied by Open Matchday.
    lineups: [],
    players: [],

    // Goal minutes are not full play-by-play events.
    events: [],

    unavailable: [
      "lineups",
      "players",
      "ratings",
      "timeline"
    ]
  };
}

function calculateStandings(matches, league) {
  const rows = matches.filter(match =>
    match.leagueId === league.id &&
    match.finished &&
    match.homeScore !== null &&
    match.awayScore !== null
  );

  const table = new Map();

  function getTeam(name) {
    if (!table.has(name)) {
      table.set(name, {
        rank: 0,
        team: { name },
        all: {
          played: 0,
          win: 0,
          draw: 0,
          lose: 0,
          goals: { for: 0, against: 0 }
        },
        points: 0,
        goalsDiff: 0
      });
    }

    return table.get(name);
  }

  rows.forEach(match => {
    const home = getTeam(match.home);
    const away = getTeam(match.away);

    const hs = match.homeScore;
    const as = match.awayScore;

    home.all.played++;
    away.all.played++;

    home.all.goals.for += hs;
    home.all.goals.against += as;

    away.all.goals.for += as;
    away.all.goals.against += hs;

    if (hs > as) {
      home.all.win++;
      away.all.lose++;
      home.points += 3;
    } else if (hs < as) {
      away.all.win++;
      home.all.lose++;
      away.points += 3;
    } else {
      home.all.draw++;
      away.all.draw++;
      home.points++;
      away.points++;
    }
  });

  const result = [...table.values()].map(team => {
    team.goalsDiff =
      team.all.goals.for - team.all.goals.against;

    return team;
  });

  result.sort((a, b) =>
    b.points - a.points ||
    b.goalsDiff - a.goalsDiff ||
    b.all.goals.for - a.all.goals.for
  );

  result.forEach((team, index) => {
    team.rank = index + 1;
  });

  return result;
}

function matchById(matches, id) {
  return matches.find(match =>
    match.id === String(id)
  );
}

async function route(type, q) {
  const date = q.date || jakartaDate();

  switch (type) {
    case "home": {
      const matches = await getAllMatches();

      const today = matches.filter(match =>
        match.date.slice(0, 10) === date
      );

      return {
        date,
        matches: today,
        leagues: getLeagues(),
        live: [],
        posters: today.slice(0, 5)
      };
    }

    case "leagues":
    case "hl-leagues":
      return getLeagues();

    case "matches":
    case "hl-matches": {
      const all = await getAllMatches();

      return all.filter(match => {
        const sameDate =
          match.date.slice(0, 10) === date;

        const sameLeague =
          !q.league ||
          String(match.leagueId) === String(q.league);

        return sameDate && sameLeague;
      });
    }

    case "match":
    case "hl-match": {
      const all = await getAllMatches();
      const match = matchById(all, q.id);

      if (!match) {
        throw new Error("Pertandingan tidak ditemukan");
      }

      return getMatchDetail(match);
    }

    case "statistics": {
      const all = await getAllMatches();
      const match = matchById(all, q.id);

      return match ? getStatistics(match) : [];
    }

    case "lineups":
    case "hl-lineups":
    case "ratings":
    case "players":
    case "hl-boxscore":
    case "events":
    case "timeline":
      return [];

    case "standings": {
      const league = findLeague(q.league);

      if (!league) return [];

      const all = await getAllMatches();

      return calculateStandings(all, league);
    }

    case "h2h":
    case "hl-h2h": {
      const all = await getAllMatches();

      const home = String(q.team1 || "");
      const away = String(q.team2 || "");

      if (!home || !away) return [];

      return all.filter(match => {
        const pair =
          [match.home.toLowerCase(), match.away.toLowerCase()];

        return pair.includes(home.toLowerCase()) &&
          pair.includes(away.toLowerCase());
      }).slice(-10);
    }

    case "predictions":
      return null;

    case "team-form": {
      const all = await getAllMatches();

      return all.filter(match =>
        match.homeId === q.team ||
        match.awayId === q.team
      ).slice(-5);
    }

    default:
      throw new Error(`Jenis permintaan tidak dikenal: ${type}`);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  // Allow CDN/browser caching for 10 minutes.
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=600, stale-while-revalidate=3600"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const data = await route(
      req.query?.type || "home",
      req.query || {}
    );

    return res.status(200).json({
      ok: true,
      data,
      source: "Open Matchday",
      liveData: false
    });
  } catch (error) {
    console.error("Football Forum API:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Server error"
    });
  }
};
