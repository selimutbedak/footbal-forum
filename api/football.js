const BASE = "https://api.football-data.org/v4";
const cache = new Map();
const CACHE_MS = 60 * 1000;

const LEAGUES = [
  { id: "PL", name: "Premier League", country: "England" },
  { id: "ELC", name: "Championship", country: "England" },
  { id: "BL1", name: "Bundesliga", country: "Germany" },
  { id: "SA", name: "Serie A", country: "Italy" },
  { id: "PD", name: "La Liga", country: "Spain" },
  { id: "FL1", name: "Ligue 1", country: "France" },
  { id: "DED", name: "Eredivisie", country: "Netherlands" },
  { id: "PPL", name: "Primeira Liga", country: "Portugal" },
  { id: "BSA", name: "Brasileirão", country: "Brazil" },
  { id: "CL", name: "UEFA Champions League", country: "Europe" },
  { id: "EC", name: "European Championship", country: "Europe" },
  { id: "WC", name: "FIFA World Cup", country: "World" }
];

function jakartaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function addDays(value, amount) {
  const date = new Date(`${value}T12:00:00+07:00`);
  date.setDate(date.getDate() + amount);
  return jakartaDate(date);
}

function localMatchDate(value) {
  if (!value) return "";
  return jakartaDate(new Date(value));
}

function validDate(value) {
  if (!value) return jakartaDate();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Format tanggal tidak valid.");
  }

  return value;
}

async function footballFetch(path) {
  const token = process.env.FOOTBALL_DATA_TOKEN;

  if (!token) {
    const error = new Error(
      "FOOTBALL_DATA_TOKEN belum dipasang di Vercel."
    );
    error.status = 500;
    throw error;
  }

  const url = BASE + path;
  const old = cache.get(url);

  if (old && Date.now() - old.time < CACHE_MS) {
    return old.data;
  }

  const response = await fetch(url, {
    headers: {
      "X-Auth-Token": token,
      "Accept": "application/json"
    }
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      body.message ||
      body.error ||
      `API error ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  cache.set(url, {
    time: Date.now(),
    data: body
  });

  return body;
}

function normalizeMatch(match) {
  const home = match.homeTeam || {};
  const away = match.awayTeam || {};
  const competition = match.competition || {};
  const score = match.score || {};
  const fullTime = score.fullTime || {};
  const halfTime = score.halfTime || {};

  const leagueCode = competition.code || "";

  return {
    id: match.id,
    date: match.utcDate || null,
    localDate: localMatchDate(match.utcDate),

    status: match.status || "SCHEDULED",
    statusShort: match.status || "SCHEDULED",
    minute: match.minute ?? null,

    live: ["IN_PLAY", "PAUSED", "LIVE"].includes(match.status),
    finished: match.status === "FINISHED",

    home: home.name || "Home",
    away: away.name || "Away",

    homeId: home.id || null,
    awayId: away.id || null,

    homeLogo:
      home.crest ||
      (home.id ? `https://crests.football-data.org/${home.id}.svg` : ""),

    awayLogo:
      away.crest ||
      (away.id ? `https://crests.football-data.org/${away.id}.svg` : ""),

    homeScore: fullTime.home ?? null,
    awayScore: fullTime.away ?? null,

    halfHomeScore: halfTime.home ?? null,
    halfAwayScore: halfTime.away ?? null,

    league: competition.name || "",
    leagueId: leagueCode,

    leagueLogo:
      competition.emblem ||
      (leagueCode ? `https://crests.football-data.org/${leagueCode}.png` : ""),

    country: match.area?.name || "",
    matchday: match.matchday || null,
    stage: match.stage || "",
    venue: match.venue || "",
    referee: match.referees?.[0]?.name || ""
  };
}

function findLeague(code) {
  return LEAGUES.find(
    item => item.id === String(code || "").toUpperCase()
  );
}

async function getMatches(fromValue, toValue, leagueCode = "ALL") {
  const from = validDate(fromValue);
  const to = validDate(toValue || from);

  // Football-Data.org memakai dateTo eksklusif.
  const exclusiveTo = addDays(to, 1);

  const query =
    `?dateFrom=${encodeURIComponent(from)}` +
    `&dateTo=${encodeURIComponent(exclusiveTo)}`;

  let result;

  if (leagueCode && leagueCode !== "ALL") {
    const league = findLeague(leagueCode);

    if (!league) {
      throw new Error("Kompetisi tidak dikenali.");
    }

    result = await footballFetch(
      `/competitions/${league.id}/matches${query}`
    );
  } else {
    result = await footballFetch(`/matches${query}`);
  }

  return (result.matches || [])
    .map(normalizeMatch)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

async function getCompetitions() {
  const result = await footballFetch("/competitions");

  const available = new Map(
    (result.competitions || []).map(item => [item.code, item])
  );

  return LEAGUES.map(league => {
    const item = available.get(league.id);

    return {
      ...league,
      emblem:
        item?.emblem ||
        `https://crests.football-data.org/${league.id}.png`,
      available: Boolean(item)
    };
  });
}

async function getStandings(code) {
  const league = findLeague(code);

  if (!league) {
    throw new Error("Kompetisi tidak ditemukan.");
  }

  return footballFetch(
    `/competitions/${league.id}/standings`
  );
}

async function getMatch(id) {
  if (!/^\d+$/.test(String(id || ""))) {
    throw new Error("ID pertandingan tidak valid.");
  }

  const result = await footballFetch(`/matches/${id}`);

  return {
    fixture: normalizeMatch(result),
    score: result.score || {},
    goals: result.goals || [],
    bookings: result.bookings || [],
    substitutions: result.substitutions || [],
    referees: result.referees || []
  };
}

function send(res, status, body) {
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    "s-maxage=60, stale-while-revalidate=120"
  );

  if (req.method !== "GET") {
    return send(res, 405, {
      ok: false,
      error: "Method tidak diizinkan."
    });
  }

  try {
    const {
      type = "home",
      date,
      dateFrom,
      dateTo,
      league,
      id
    } = req.query;

    let data;

    switch (type) {
      case "home": {
        const today = validDate(date);
        const nextWeek = addDays(today, 7);

        const matches = await getMatches(today, nextWeek, "ALL");

        const todayMatches = matches.filter(
          match => match.localDate === today
        );

        const upcoming = matches.filter(
          match => match.localDate > today && !match.finished
        );

        data = {
          date: today,
          matches: todayMatches,
          upcoming,
          live: matches.filter(match => match.live)
        };
        break;
      }

      case "matches": {
        const from = validDate(dateFrom || date);
        const to = validDate(dateTo || dateFrom || date);

        data = await getMatches(from, to, league || "ALL");
        break;
      }

      case "leagues": {
        data = await getCompetitions();
        break;
      }

      case "standings": {
        data = await getStandings(league);
        break;
      }

      case "match": {
        data = await getMatch(id);
        break;
      }

      default:
        return send(res, 400, {
          ok: false,
          error: "Jenis permintaan tidak dikenal."
        });
    }

    return send(res, 200, {
      ok: true,
      data
    });

  } catch (error) {
    console.error("FOOTBALL API ERROR:", error);

    let message = error.message || "Terjadi kesalahan.";
    const status = error.status || 500;

    if (status === 401) {
      message = "Token API tidak valid. Periksa FOOTBALL_DATA_TOKEN.";
    } else if (status === 403) {
      message = "Kompetisi ini tidak tersedia pada paket API kamu.";
    } else if (status === 429) {
      message = "Batas permintaan API tercapai. Coba lagi nanti.";
    } else if (status === 404) {
      message = "Data tidak ditemukan.";
    }

    return send(res, status, {
      ok: false,
      error: message
    });
  }
}
