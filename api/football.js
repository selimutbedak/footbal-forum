const BASE_URL = "https://api.football-data.org/v4";
const CACHE_TIME = 60 * 1000;
const cache = new Map();

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

function send(res, status, body) {
  return res.status(status).json(body);
}

function jakartaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T12:00:00+07:00`);
  date.setDate(date.getDate() + days);
  return jakartaDate(date);
}

function validDate(value) {
  if (!value) return jakartaDate();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Format tanggal harus YYYY-MM-DD.");
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

  const url = BASE_URL + path;
  const cached = cache.get(url);

  if (cached && Date.now() - cached.time < CACHE_TIME) {
    return cached.data;
  }

  const response = await fetch(url, {
    headers: {
      "X-Auth-Token": token,
      "Accept": "application/json"
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.message ||
      data.error ||
      `Football-Data error ${response.status}`
    );

    error.status = response.status;
    throw error;
  }

  cache.set(url, {
    time: Date.now(),
    data
  });

  return data;
}

function normalizeMatch(match) {
  const home = match.homeTeam || {};
  const away = match.awayTeam || {};
  const competition = match.competition || {};
  const score = match.score || {};
  const fullTime = score.fullTime || {};
  const halfTime = score.halfTime || {};

  return {
    id: match.id,
    date: match.utcDate || null,
    status: match.status || "SCHEDULED",
    statusShort: match.status || "SCHEDULED",
    minute: match.minute || null,

    live: [
      "IN_PLAY",
      "PAUSED",
      "LIVE"
    ].includes(match.status),

    finished: match.status === "FINISHED",

    home: home.name || "Home",
    away: away.name || "Away",

    homeId: home.id || null,
    awayId: away.id || null,

    homeShort: home.shortName || home.tla || home.name || "",
    awayShort: away.shortName || away.tla || away.name || "",

    homeLogo: home.crest || "",
    awayLogo: away.crest || "",

    homeScore: fullTime.home ?? null,
    awayScore: fullTime.away ?? null,

    halfHomeScore: halfTime.home ?? null,
    halfAwayScore: halfTime.away ?? null,

    league: competition.name || "",
    leagueId: competition.code || "",
    leagueLogo: competition.emblem || "",
    country: competition.area?.name || "",

    matchday: match.matchday || null,
    stage: match.stage || "",
    group: match.group || "",

    venue: match.venue || "",
    referee: match.referees?.[0]?.name || "",

    winner: score.winner || null
  };
}

function getLeague(code) {
  return LEAGUES.find(
    league => league.id === String(code || "").toUpperCase()
  );
}

async function getMatches(dateFrom, dateTo, competition) {
  const from = validDate(dateFrom);
  const to = validDate(dateTo || dateFrom);

  const query =
    `?dateFrom=${encodeURIComponent(from)}` +
    `&dateTo=${encodeURIComponent(to)}`;

  let result;

  if (competition && competition !== "ALL") {
    const league = getLeague(competition);

    if (!league) {
      throw new Error("Kompetisi tidak tersedia.");
    }

    result = await footballFetch(
      `/competitions/${league.id}/matches${query}`
    );
  } else {
    result = await footballFetch(`/matches${query}`);
  }

  return (result.matches || []).map(normalizeMatch);
}

async function getCompetitions() {
  const result = await footballFetch("/competitions");
  const available = new Map(
    (result.competitions || []).map(item => [item.code, item])
  );

  return LEAGUES.map(league => {
    const competition = available.get(league.id);

    return {
      ...league,
      emblem: competition?.emblem || "",
      available: Boolean(competition)
    };
  });
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

async function getStandings(code) {
  const league = getLeague(code);

  if (!league) {
    throw new Error("Kompetisi tidak tersedia.");
  }

  const result = await footballFetch(
    `/competitions/${league.id}/standings`
  );

  return {
    competition: result.competition || {},
    season: result.season || {},
    standings: result.standings || []
  };
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

        const [matches, leagues] = await Promise.all([
          getMatches(today, nextWeek, "ALL"),
          getCompetitions()
        ]);

        const todayMatches = matches.filter(
          match => match.date?.slice(0, 10) === today
        );

        const upcoming = matches.filter(
          match =>
            match.date?.slice(0, 10) > today &&
            !match.finished
        );

        data = {
          date: today,
          matches: todayMatches,
          upcoming,
          live: matches.filter(match => match.live),
          leagues
        };
        break;
      }

      case "matches": {
        const from = validDate(dateFrom || date);
        const to = validDate(dateTo || dateFrom || date);

        data = await getMatches(
          from,
          to,
          league || "ALL"
        );
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
          error: "Tipe permintaan tidak dikenal."
        });
    }

    return send(res, 200, {
      ok: true,
      data
    });

  } catch (error) {
    console.error("Football Forum API:", error);

    const status = error.status || 500;
    let message = error.message || "Terjadi kesalahan.";

    if (status === 401) {
      message = "Token Football-Data.org tidak valid. Periksa FOOTBALL_DATA_TOKEN di Vercel.";
    } else if (status === 403) {
      message = "Data kompetisi ini tidak tersedia pada paket API kamu.";
    } else if (status === 429) {
      message = "Batas permintaan API tercapai. Tunggu sebentar lalu coba lagi.";
    } else if (status === 404) {
      message = "Data tidak ditemukan.";
    }

    return send(res, status, {
      ok: false,
      error: message
    });
  }
}
