
const cache = new Map();

const CACHE_TTL = 60 * 60 * 1000;

// Daftar kompetisi yang tersedia dari OpenFootball.
// ID dipakai frontend sebagai league.id.
const LEAGUES = [
  {
    id: "en.1",
    name: "Premier League",
    country: "England",
    countryCode: "GB",
    season: "2026-27"
  },
  {
    id: "en.2",
    name: "Championship",
    country: "England",
    countryCode: "GB",
    season: "2026-27"
  },
  {
    id: "de.1",
    name: "Bundesliga",
    country: "Germany",
    countryCode: "DE",
    season: "2026-27"
  },
  {
    id: "de.2",
    name: "2. Bundesliga",
    country: "Germany",
    countryCode: "DE",
    season: "2026-27"
  },
  {
    id: "es.1",
    name: "La Liga",
    country: "Spain",
    countryCode: "ES",
    season: "2026-27"
  },
  {
    id: "it.1",
    name: "Serie A",
    country: "Italy",
    countryCode: "IT",
    season: "2026-27"
  },
  {
    id: "fr.1",
    name: "Ligue 1",
    country: "France",
    countryCode: "FR",
    season: "2026-27"
  },
  {
    id: "us.1",
    name: "MLS",
    country: "USA",
    countryCode: "US",
    season: "2026"
  }
];

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

function setCached(key, data, ttl = CACHE_TTL) {
  cache.set(key, {
    data,
    expires: Date.now() + ttl
  });
}

async function fetchJSON(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json"
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error(`OpenFootball HTTP ${response.status}`);
  }

  return response.json();
}

function seasonForLeague(league) {
  return league.season;
}

function leagueURL(league) {
  return (
    "https://raw.githubusercontent.com/openfootball/football.json/master/" +
    seasonForLeague(league) +
    "/" +
    league.id +
    ".json"
  );
}

async function getLeagueMatches(league) {
  const cacheKey = `openfootball:${league.id}`;

  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  const json = await fetchJSON(leagueURL(league));

  const matches = Array.isArray(json.matches)
    ? json.matches
    : [];

  const result = matches.map((match, index) => ({
    ...match,
    _league: league,
    _matchId: `${league.id}-${index}`
  }));

  setCached(cacheKey, result);

  return result;
}

async function getAllMatches() {
  const results = await Promise.allSettled(
    LEAGUES.map(league => getLeagueMatches(league))
  );

  const matches = [];

  results.forEach(result => {
    if (result.status === "fulfilled") {
      matches.push(...result.value);
    } else {
      console.error("OpenFootball league error:", result.reason);
    }
  });

  return matches;
}

function matchStatus(match) {
  const score = match.score?.ft;

  if (
    Array.isArray(score) &&
    score.length >= 2 &&
    score[0] !== null &&
    score[1] !== null
  ) {
    return {
      description: "Finished",
      code: "FT",
      score: {
        current: {
          home: Number(score[0]),
          away: Number(score[1])
        }
      }
    };
  }

  return {
    description: "Not started",
    code: "NS",
    score: {
      current: {
        home: null,
        away: null
      }
    }
  };
}

function normalizeOpenMatch(match) {
  const league = match._league;
  const state = matchStatus(match);

  return {
    id: match._matchId,

    date: match.date || null,

    state,

    league: {
      id: league.id,
      name: league.name,
      logo: null
    },

    country: {
      name: league.country,
      code: league.countryCode
    },

    homeTeam: {
      id: match.team1,
      name: match.team1,
      logo: null
    },

    awayTeam: {
      id: match.team2,
      name: match.team2,
      logo: null
    },

    venue: {
      name: match.venue || ""
    },

    referee: null,

    round: match.round || "",

    score: match.score || null
  };
}

function sendError(res, error) {
  console.error("FOOTBALL FORUM:", error);

  return res.status(500).json({
    error: "Gagal mengambil data OpenFootball",
    message: error.message
  });
}

export default async function handler(req, res) {
  const type = String(req.query.type || "");

  try {
    // =====================================
    // DAFTAR LIGA
    // =====================================

    if (type === "hl-leagues") {
      const leagues = LEAGUES.map(league => ({
        id: league.id,
        name: league.name,
        logo: null,
        country: {
          name: league.country,
          code: league.countryCode
        },
        seasons: [
          {
            year: league.season,
            current: true
          }
        ]
      }));

      return res.status(200).json({
        provider: "OpenFootball",
        type,
        data: leagues
      });
    }

    // =====================================
    // DAFTAR PERTANDINGAN
    // =====================================

    if (type === "hl-matches") {
      const date = String(req.query.date || jakartaDate());
      const leagueId = req.query.leagueId || null;

      let matches;

      if (leagueId) {
        const league = LEAGUES.find(
          item => item.id === String(leagueId)
        );

        if (!league) {
          return res.status(404).json({
            error: "Liga tidak ditemukan."
          });
        }

        matches = await getLeagueMatches(league);
      } else {
        matches = await getAllMatches();
      }

      let filtered = matches;

      if (date) {
        filtered = filtered.filter(
          match => match.date === date
        );
      }

      if (leagueId) {
        filtered = filtered.filter(
          match => match._league.id === String(leagueId)
        );
      }

      const limit = Math.min(
        Math.max(Number(req.query.limit) || 100, 1),
        500
      );

      const data = filtered
        .slice(0, limit)
        .map(normalizeOpenMatch);

      res.setHeader(
        "Cache-Control",
        "s-maxage=3600, stale-while-revalidate=86400"
      );

      return res.status(200).json({
        provider: "OpenFootball",
        type,
        data
      });
    }

    // =====================================
    // DETAIL PERTANDINGAN
    // =====================================

    if (type === "hl-match") {
      const id = String(req.query.id || "");

      if (!id) {
        return res.status(400).json({
          error: "Parameter id wajib diisi."
        });
      }

      const matches = await getAllMatches();

      const match = matches.find(
        item => item._matchId === id
      );

      if (!match) {
        return res.status(404).json({
          error: "Pertandingan tidak ditemukan."
        });
      }

      return res.status(200).json({
        provider: "OpenFootball",
        type,
        data: normalizeOpenMatch(match)
      });
    }

    // =====================================
    // H2H
    // =====================================

    if (type === "hl-h2h") {
      const team1 = String(req.query.team1 || "");
      const team2 = String(req.query.team2 || "");

      if (!team1 || !team2) {
        return res.status(400).json({
          error: "Parameter team1 dan team2 wajib diisi."
        });
      }

      const matches = await getAllMatches();

      const data = matches
        .filter(match => {
          const a = String(match.team1).toLowerCase();
          const b = String(match.team2).toLowerCase();

          return (
            (a === team1.toLowerCase() && b === team2.toLowerCase()) ||
            (a === team2.toLowerCase() && b === team1.toLowerCase())
          );
        })
        .map(normalizeOpenMatch);

      return res.status(200).json({
        provider: "OpenFootball",
        type,
        data
      });
    }

    // =====================================
    // FITUR YANG TIDAK DISEDIAKAN
    // =====================================

    if (
      [
        "hl-statistics",
        "hl-lineups",
        "hl-events",
        "hl-boxscore"
      ].includes(type)
    ) {
      return res.status(200).json({
        provider: "OpenFootball",
        type,
        data: []
      });
    }

    return res.status(400).json({
      error: "Jenis endpoint tidak dikenal.",
      type
    });

  } catch (error) {
    return sendError(res, error);
  }
}
