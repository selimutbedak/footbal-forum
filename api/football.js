"use strict";

const API = "https://v3.football.api-sports.io";
const OPEN = "https://raw.githubusercontent.com/openfootball/football.json/master";
const cache = new Map();

const LEAGUES = [
  { country:"Argentina", flag:"🇦🇷", name:"Liga Profesional Argentina", id:128, file:"ar.1" },
  { country:"Argentina", flag:"🇦🇷", name:"Primera Nacional", id:129, file:null },
  { country:"Argentina", flag:"🇦🇷", name:"Copa Argentina", id:130, file:null },
  { country:"Brazil", flag:"🇧🇷", name:"Brasileirão Série A", id:71, file:"br.1" },
  { country:"Brazil", flag:"🇧🇷", name:"Brasileirão Série B", id:72, file:null },
  { country:"England", flag:"🏴", name:"Premier League", id:39, file:"en.1" },
  { country:"England", flag:"🏴", name:"Championship", id:40, file:"en.2" },
  { country:"England", flag:"🏴", name:"League One", id:41, file:"en.3" },
  { country:"England", flag:"🏴", name:"League Two", id:42, file:"en.4" },
  { country:"France", flag:"🇫🇷", name:"Ligue 1", id:61, file:"fr.1" },
  { country:"France", flag:"🇫🇷", name:"Ligue 2", id:62, file:"fr.2" },
  { country:"Germany", flag:"🇩🇪", name:"Bundesliga", id:78, file:"de.1" },
  { country:"Germany", flag:"🇩🇪", name:"2. Bundesliga", id:79, file:"de.2" },
  { country:"Germany", flag:"🇩🇪", name:"3. Liga", id:80, file:"de.3" },
  { country:"Italy", flag:"🇮🇹", name:"Serie A", id:135, file:"it.1" },
  { country:"Italy", flag:"🇮🇹", name:"Serie B", id:136, file:"it.2" },
  { country:"Spain", flag:"🇪🇸", name:"La Liga", id:140, file:"es.1" },
  { country:"Spain", flag:"🇪🇸", name:"Segunda División", id:141, file:"es.2" },
  { country:"USA", flag:"🇺🇸", name:"MLS", id:253, file:"us.1" },
  { country:"Netherlands", flag:"🇳🇱", name:"Eredivisie", id:88, file:"nl.1" },
  { country:"Portugal", flag:"🇵🇹", name:"Primeira Liga", id:94, file:"pt.1" },
  { country:"Scotland", flag:"🏴", name:"Premiership", id:179, file:"sco.1" }
];

const ttl = {
  open: 6 * 60 * 60 * 1000,
  leagues: 6 * 60 * 60 * 1000,
  matches: 2 * 60 * 1000,
  detail: 90 * 1000,
  standings: 30 * 60 * 1000
};

function cached(key) {
  const v = cache.get(key);
  if (!v || Date.now() > v.until) {
    cache.delete(key);
    return null;
  }
  return v.data;
}

function save(key, data, ms) {
  cache.set(key, { data, until: Date.now() + ms });
  return data;
}

async function getJSON(url, headers = {}) {
  const r = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || `HTTP ${r.status}`);
  return data;
}

async function apiFootball(path, params = {}, life = ttl.detail) {
  const key = "api:" + path + ":" + JSON.stringify(params);
  const old = cached(key);
  if (old) return old;

  if (!process.env.API_FOOTBALL_KEY) {
    throw new Error("API_FOOTBALL_KEY belum diatur di Vercel.");
  }

  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, v);
    }
  }

  const json = await getJSON(url.toString(), {
    "x-apisports-key": process.env.API_FOOTBALL_KEY
  });

  if (json.errors && Object.keys(json.errors).length) {
    throw new Error(JSON.stringify(json.errors));
  }

  return save(key, json.response || [], life);
}

function currentSeason() {
  const now = new Date();
  return now.getUTCMonth() >= 6
    ? now.getUTCFullYear()
    : now.getUTCFullYear() - 1;
}

function dateToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function mapOpenMatch(m, league) {
  const score = m.score?.ft || m.score?.pen || null;
  const date = m.date ? new Date(m.date + "T12:00:00Z") : null;
  return {
    id: `open:${league.file}:${m.date}:${m.team1}:${m.team2}`,
    date: m.date,
    timestamp: date ? Math.floor(date.getTime() / 1000) : null,
    home: m.team1,
    away: m.team2,
    homeScore: score ? Number(score[0]) : null,
    awayScore: score ? Number(score[1]) : null,
    finished: !!score,
    round: m.round || "",
    league: league.name,
    country: league.country,
    flag: league.flag,
    source: "OpenFootball"
  };
}

async function openLeagueMatches(league, season) {
  if (!league.file) return [];
  const key = `open:${season}:${league.file}`;
  const old = cached(key);
  if (old) return old;

  const json = await getJSON(`${OPEN}/${season}/${league.file}.json`);
  const rows = Array.isArray(json.matches) ? json.matches : [];
  return save(key, rows.map(m => mapOpenMatch(m, league)), ttl.open);
}

async function openPosters(date) {
  const season = currentSeason() + "-" + String(currentSeason() + 1).slice(-2);
  const results = await Promise.allSettled(
    LEAGUES.filter(l => l.file).map(l => openLeagueMatches(l, season))
  );

  return results
    .filter(x => x.status === "fulfilled")
    .flatMap(x => x.value)
    .filter(m => m.date >= date)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 24);
}

async function getLeagues() {
  try {
    const rows = await apiFootball("/leagues", { current: "true" }, ttl.leagues);
    return rows.map(x => ({
      id: x.league.id,
      name: x.league.name,
      logo: x.league.logo,
      country: x.country?.name || "International",
      flag: x.country?.flag || "",
      seasons: x.seasons || [],
      source: "API-Football"
    }));
  } catch (e) {
    return LEAGUES.map(l => ({
      id: l.id, name: l.name, country: l.country,
      flag: l.flag, logo: null, seasons: [], source: "OpenFootball"
    }));
  }
}

function mapFixture(x) {
  const f = x.fixture || {};
  const h = x.teams?.home || {};
  const a = x.teams?.away || {};
  const st = f.status || {};
  const short = st.short || "NS";
  const live = ["1H","2H","HT","ET","BT","P","LIVE"].includes(short);
  const done = ["FT","AET","PEN"].includes(short);

  return {
    id: f.id,
    date: f.date,
    timestamp: f.timestamp,
    status: short,
    statusText: st.long || "",
    elapsed: st.elapsed,
    live,
    finished: done,
    league: x.league?.name || "",
    leagueId: x.league?.id,
    country: x.league?.country || "",
    home: h.name || "Home",
    away: a.name || "Away",
    homeLogo: h.logo || "",
    awayLogo: a.logo || "",
    homeId: h.id,
    awayId: a.id,
    homeScore: x.goals?.home ?? null,
    awayScore: x.goals?.away ?? null,
    source: "API-Football"
  };
}

async function getMatches(date, league, season) {
  const params = { date: date || dateToday(), timezone: "Asia/Jakarta" };
  if (league) params.league = league;
  if (season) params.season = season;

  const rows = await apiFootball("/fixtures", params, ttl.matches);
  return rows.map(mapFixture);
}

async function getStandings(league, season) {
  return apiFootball("/standings", { league, season }, ttl.standings);
}

async function getMatch(id) {
  const [fixture, lineups, stats, players, events] = await Promise.all([
    apiFootball("/fixtures", { id }),
    apiFootball("/fixtures/lineups", { fixture: id }),
    apiFootball("/fixtures/statistics", { fixture: id }),
    apiFootball("/fixtures/players", { fixture: id }),
    apiFootball("/fixtures/events", { fixture: id })
  ]);

  return {
    match: fixture[0] ? mapFixture(fixture[0]) : null,
    lineups,
    statistics: stats,
    players,
    events
  };
}

async function getH2H(team1, team2) {
  return (await apiFootball("/fixtures/headtohead", {
    h2h: `${team1}-${team2}`,
    last: 10
  })).map(mapFixture);
}

async function getTeamForm(team, season) {
  return (await apiFootball("/fixtures", {
    team, last: 5, season
  })).map(mapFixture);
}

async function route(q) {
  switch (q.type) {
    case "home": {
      const [leagues, posters, matches] = await Promise.all([
        getLeagues(),
        openPosters(q.date || dateToday()),
        getMatches(q.date || dateToday()).catch(() => [])
      ]);
      return { leagues, posters, matches };
    }

    case "leagues":
      return getLeagues();

    case "posters":
      return openPosters(q.date || dateToday());

    case "matches":
      return getMatches(q.date, q.league, q.season);

    case "standings":
      return getStandings(q.league, q.season);

    case "match":
      return getMatch(q.id);

    case "h2h":
      return getH2H(q.team1, q.team2);

    case "team-form":
      return getTeamForm(q.team, q.season);

    case "predictions":
      return apiFootball("/predictions", { fixture: q.fixture });

    default:
      throw new Error("Endpoint tidak dikenal.");
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const data = await route(req.query || {});
    return res.status(200).json({
      ok: true,
      provider: "OpenFootball + API-Football",
      data
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};
