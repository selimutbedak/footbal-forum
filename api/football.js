
"use strict";

/*
 * FOOTBALL FORUM — COMPATIBLE MULTI-SOURCE BACKEND
 *
 * Frontend compatible endpoints:
 * hl-leagues
 * hl-matches
 * hl-match
 * hl-statistics
 * hl-lineups
 * hl-boxscore
 * hl-h2h
 *
 * Legacy endpoints are also retained.
 */

const BASE = {
  apiFootball: "https://v3.football.api-sports.io",
  footballData: "https://api.football-data.org/v4",
  sportsDB: "https://www.thesportsdb.com/api/v1/json",
  openLiga: "https://api.openligadb.de",
  openFootball: "https://raw.githubusercontent.com/openfootball/football.json/master",
  statsBomb: "https://raw.githubusercontent.com/statsbomb/open-data/master"
};

const cache = new Map();

const TTL = {
  live: 25000,
  matches: 90000,
  details: 60000,
  standings: 1200000,
  archive: 86400000
};

const LEAGUES = [
  {id:39,name:"Premier League",country:"England",code:"GB",fd:"PL",open:"en.1"},
  {id:40,name:"Championship",country:"England",code:"GB",fd:"ELC",open:"en.2"},
  {id:140,name:"La Liga",country:"Spain",code:"ES",fd:"PD",open:"es.1"},
  {id:141,name:"Segunda División",country:"Spain",code:"ES",fd:"SD",open:"es.2"},
  {id:135,name:"Serie A",country:"Italy",code:"IT",fd:"SA",open:"it.1"},
  {id:136,name:"Serie B",country:"Italy",code:"IT",fd:"SB",open:"it.2"},
  {id:78,name:"Bundesliga",country:"Germany",code:"DE",fd:"BL1",open:"de.1",openLiga:"bl1"},
  {id:79,name:"2. Bundesliga",country:"Germany",code:"DE",fd:"BL2",open:"de.2",openLiga:"bl2"},
  {id:61,name:"Ligue 1",country:"France",code:"FR",fd:"FL1",open:"fr.1"},
  {id:62,name:"Ligue 2",country:"France",code:"FR",fd:"FL2",open:"fr.2"},
  {id:88,name:"Eredivisie",country:"Netherlands",code:"NL",fd:"DED",open:"nl.1"},
  {id:94,name:"Primeira Liga",country:"Portugal",code:"PT",fd:"PPL",open:"pt.1"},
  {id:71,name:"Brasileirão Série A",country:"Brazil",code:"BR",fd:"BSA",open:"br.1"},
  {id:253,name:"MLS",country:"USA",code:"US",fd:"MLS",open:"us.1"},
  {id:2,name:"UEFA Champions League",country:"Europe",code:"",fd:"CL"},
  {id:3,name:"UEFA Europa League",country:"Europe",code:"",fd:"EL"},
  {id:848,name:"UEFA Conference League",country:"Europe",code:""}
];

function cacheGet(key) {
  const item = cache.get(key);
  if (!item || item.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function cacheSet(key, value, ttl) {
  cache.set(key, {value, expires:Date.now()+ttl});
  return value;
}

function qs(params={}) {
  const p = new URLSearchParams();
  for (const [key,value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      p.set(key,String(value));
    }
  }
  return p.toString();
}

async function fetchJSON(url, headers={}, timeout=12000) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),timeout);

  try {
    const response = await fetch(url,{
      headers,
      signal:controller.signal
    });

    const body = await response.json().catch(()=>({}));

    if (!response.ok) {
      throw new Error(
        body.message ||
        body.errors?.message ||
        `HTTP ${response.status} (${new URL(url).hostname})`
      );
    }

    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function apiFootball(path, params={}, ttl=TTL.details) {
  const key = process.env.API_FOOTBALL_KEY;

  if (!key) throw new Error("API_FOOTBALL_KEY belum dipasang");

  const query = qs(params);
  const url = `${BASE.apiFootball}${path}${query ? "?"+query : ""}`;
  const cacheKey = "af:"+url;

  const saved = cacheGet(cacheKey);
  if (saved) return saved;

  const body = await fetchJSON(url,{
    "x-apisports-key":key
  });

  if (body.errors && Object.keys(body.errors).length) {
    throw new Error(JSON.stringify(body.errors));
  }

  return cacheSet(cacheKey,body.response || [],ttl);
}

async function footballData(path,params={},ttl=TTL.matches) {
  // Supports both names to avoid breaking existing Vercel settings.
  const token =
    process.env.FOOTBALL_DATA_TOKEN ||
    process.env.FOOTBALL_DATA_KEY;

  if (!token) throw new Error("FOOTBALL_DATA_TOKEN belum dipasang");

  const query = qs(params);
  const url = `${BASE.footballData}${path}${query ? "?"+query : ""}`;
  const key = "fd:"+url;

  const saved = cacheGet(key);
  if (saved) return saved;

  const data = await fetchJSON(url,{"X-Auth-Token":token});
  return cacheSet(key,data,ttl);
}

function sportsDBKey() {
  return process.env.THESPORTSDB_API_KEY || "123";
}

async function sportsDB(path,params={},ttl=TTL.details) {
  const query = qs(params);
  const url =
    `${BASE.sportsDB}/${sportsDBKey()}/${path}`+
    (query ? "?"+query : "");

  const key = "tsdb:"+url;
  const saved = cacheGet(key);
  if (saved) return saved;

  const data = await fetchJSON(url);
  return cacheSet(key,data,ttl);
}

async function openLiga(path) {
  const url = BASE.openLiga+path;
  const key = "ol:"+url;
  const saved = cacheGet(key);
  if (saved) return saved;

  const data = await fetchJSON(url);
  return cacheSet(key,data,TTL.matches);
}

async function openFootballFile(season,file) {
  const url = `${BASE.openFootball}/${season}/${file}.json`;
  const key = "of:"+url;
  const saved = cacheGet(key);
  if (saved) return saved;

  const data = await fetchJSON(url);
  return cacheSet(key,data,TTL.archive);
}

function seasonForDate(date) {
  const d = new Date(`${date}T12:00:00+07:00`);
  const year = d.getFullYear();
  return d.getMonth() >= 6 ? year : year-1;
}

function todayJakarta() {
  const parts = new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Jakarta",
    year:"numeric",
    month:"2-digit",
    day:"2-digit"
  }).formatToParts(new Date());

  const values = {};
  parts.forEach(x=>values[x.type]=x.value);
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizeAFMatch(item) {
  const f = item.fixture || {};
  const t = item.teams || {};
  const l = item.league || {};
  const g = item.goals || {};
  const s = f.status || {};

  const short = s.short || "";

  return {
    id:String(f.id),
    date:f.date || null,
    state:{
      code:short,
      description:s.long || short || "Unknown",
      clock:s.elapsed,
      score:{
        current:{
          home:g.home ?? null,
          away:g.away ?? null
        }
      }
    },
    venue:{
      name:f.venue?.name || ""
    },
    referee:f.referee || "",
    league:{
      id:l.id,
      name:l.name || "",
      logo:l.logo || ""
    },
    country:{
      name:l.country || "",
      code:""
    },
    homeTeam:{
      id:t.home?.id,
      name:t.home?.name || "Home",
      logo:t.home?.logo || ""
    },
    awayTeam:{
      id:t.away?.id,
      name:t.away?.name || "Away",
      logo:t.away?.logo || ""
    },
    provider:"API-Football",
    _raw:item
  };
}

function mapFootballDataMatch(item) {
  const score = item.score?.fullTime || {};

  return {
    id:`fd:${item.id}`,
    date:item.utcDate,
    state:{
      code:item.status,
      description:item.status,
      score:{
        current:{
          home:score.home ?? null,
          away:score.away ?? null
        }
      }
    },
    league:{
      id:item.competition?.id,
      name:item.competition?.name || "",
      logo:item.competition?.emblem || ""
    },
    country:{
      name:item.area?.name || "",
      code:item.area?.code || ""
    },
    homeTeam:{
      id:item.homeTeam?.id,
      name:item.homeTeam?.name || "Home",
      logo:item.homeTeam?.crest || ""
    },
    awayTeam:{
      id:item.awayTeam?.id,
      name:item.awayTeam?.name || "Away",
      logo:item.awayTeam?.crest || ""
    },
    provider:"football-data.org"
  };
}

function mapSportsDBEvent(item) {
  return {
    id:`tsdb:${item.idEvent}`,
    date:item.strTimestamp ||
      `${item.dateEvent || ""}T${item.strTime || "00:00:00"}`,
    state:{
      code:item.strStatus || "",
      description:item.strStatus || "Scheduled",
      score:{
        current:{
          home:item.intHomeScore == null ? null : Number(item.intHomeScore),
          away:item.intAwayScore == null ? null : Number(item.intAwayScore)
        }
      }
    },
    league:{
      id:item.idLeague,
      name:item.strLeague || "",
      logo:item.strLeagueBadge || ""
    },
    country:{
      name:item.strCountry || "",
      code:""
    },
    homeTeam:{
      name:item.strHomeTeam || "Home",
      logo:item.strHomeTeamBadge || ""
    },
    awayTeam:{
      name:item.strAwayTeam || "Away",
      logo:item.strAwayTeamBadge || ""
    },
    provider:"TheSportsDB"
  };
}

function mapOpenFootballMatch(item,league) {
  const score = item.score?.ft || item.score?.regular || null;

  return {
    id:`of:${league.id}:${item.date}:${item.team1}:${item.team2}`,
    date:item.date,
    state:{
      code:score ? "FT" : "NS",
      description:score ? "Finished" : "Scheduled",
      score:{
        current:{
          home:score?.[0] ?? null,
          away:score?.[1] ?? null
        }
      }
    },
    league:{
      id:league.id,
      name:league.name,
      logo:""
    },
    country:{
      name:league.country,
      code:league.code
    },
    homeTeam:{name:item.team1,logo:""},
    awayTeam:{name:item.team2,logo:""},
    provider:"OpenFootball"
  };
}

function dedupe(rows) {
  const seen = new Set();

  return rows.filter(m=>{
    const key = [
      String(m.date || "").slice(0,10),
      (m.homeTeam?.name || "").toLowerCase(),
      (m.awayTeam?.name || "").toLowerCase()
    ].join("|");

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortMatches(rows) {
  return rows.sort((a,b)=>
    new Date(a.date || 0)-new Date(b.date || 0)
  );
}

async function getFixtures(date,leagueId) {
  const season = seasonForDate(date);
  const params = {
    date,
    timezone:"Asia/Jakarta"
  };

  if (leagueId) {
    params.league = leagueId;
    params.season = season;
  }

  const rows = await apiFootball("/fixtures",params,TTL.live);
  return rows.map(normalizeAFMatch);
}

async function getFallbackFixtures(date,leagueId) {
  const output = [];
  const errors = [];

  // football-data.org
  const league = LEAGUES.find(x=>String(x.id)===String(leagueId));

  if (process.env.FOOTBALL_DATA_TOKEN || process.env.FOOTBALL_DATA_KEY) {
    try {
      let path = "/matches";
      const params = {dateFrom:date,dateTo:date};

      if (league?.fd) {
        path = `/competitions/${league.fd}/matches`;
      }

      const data = await footballData(path,params);
      const rows = (data.matches || []).map(mapFootballDataMatch);
      output.push(...rows);
    } catch (e) {
      errors.push("football-data.org: "+e.message);
    }
  }

  // TheSportsDB
  try {
    const data = await sportsDB("eventsday.php",{
      d:date,
      s:"Soccer"
    },TTL.matches);

    const rows = (data.events || []).map(mapSportsDBEvent);
    output.push(...rows);
  } catch (e) {
    errors.push("TheSportsDB: "+e.message);
  }

  // OpenLigaDB: Germany competitions only
  if (!leagueId || ["78","79"].includes(String(leagueId))) {
    const german = LEAGUES.filter(x=>x.openLiga);

    const results = await Promise.allSettled(
      german.map(async l=>{
        const year = seasonForDate(date);
        const rows = await openLiga(`/getmatchdata/${l.openLiga}/${year}`);

        return rows
          .filter(x=>
            String(x.matchDateTimeUTC || x.matchDateTime || "").slice(0,10)===date
          )
          .map(x=>({
            id:`ol:${x.matchID}`,
            date:x.matchDateTimeUTC || x.matchDateTime,
            state:{
              code:x.matchIsFinished ? "FT" : "NS",
              description:x.matchIsFinished ? "Finished" : "Scheduled",
              score:{
                current:{
                  home:x.matchResults?.[0]?.pointsTeam1 ?? null,
                  away:x.matchResults?.[0]?.pointsTeam2 ?? null
                }
              }
            },
            league:{id:l.id,name:l.name,logo:""},
            country:{name:"Germany",code:"DE"},
            homeTeam:{
              name:x.team1?.teamName || "Home",
              logo:x.team1?.teamIconUrl || ""
            },
            awayTeam:{
              name:x.team2?.teamName || "Away",
              logo:x.team2?.teamIconUrl || ""
            },
            provider:"OpenLigaDB"
          }));
      })
    );

    results.forEach(r=>{
      if (r.status==="fulfilled") output.push(...r.value);
      else errors.push("OpenLigaDB: "+r.reason?.message);
    });
  }

  // OpenFootball: date-only fixtures/results
  if (league?.open) {
    try {
      const start = seasonForDate(date);
      const season = `${start}-${String(start+1).slice(-2)}`;
      const data = await openFootballFile(season,league.open);

      output.push(...(data.matches || [])
        .filter(x=>x.date===date)
        .map(x=>mapOpenFootballMatch(x,league)));
    } catch (e) {
      errors.push("OpenFootball: "+e.message);
    }
  }

  return {matches:output,errors};
}

async function getMatches(date,leagueId) {
  const key = `matches:${date}:${leagueId || "all"}`;
  const saved = cacheGet(key);
  if (saved) return saved;

  let rows = [];
  const errors = [];

  // Search the requested league directly. Do not download all fixtures
  // and then accidentally skip fallback because another league has games.
  try {
    rows = await getFixtures(date,leagueId);
  } catch (e) {
    errors.push("API-Football: "+e.message);
  }

  // When a specific league has no matches from the primary source,
  // check other providers for that same date and competition.
  if (!rows.length) {
    const fallback = await getFallbackFixtures(date,leagueId);
    rows = fallback.matches;
    errors.push(...fallback.errors);
  }

  // For all matches, fallback only fills missing dates if the main
  // provider itself fails or returns no fixtures.
  if (!leagueId && !rows.length) {
    const fallback = await getFallbackFixtures(date,null);
    rows = fallback.matches;
    errors.push(...fallback.errors);
  }

  if (leagueId) {
    rows = rows.filter(x=>
      String(x.league?.id)===String(leagueId) ||
      (x.provider==="OpenFootball" &&
       String(x.league?.id)===String(leagueId))
    );
  }

  rows = sortMatches(dedupe(rows));

  return cacheSet(key,{
    matches:rows,
    errors,
    provider:rows[0]?.provider || null
  },TTL.matches);
}

async function getLeagues() {
  const key = "leagues:catalog";
  const saved = cacheGet(key);
  if (saved) return saved;

  let apiRows = [];

  try {
    apiRows = await apiFootball("/leagues",{current:"true"},TTL.standings);
  } catch (_) {}

  const output = LEAGUES.map(l=>{
    const found = apiRows.find(x=>
      Number(x.league?.id)===Number(l.id)
    );

    const current = found?.seasons?.find(x=>x.current);

    return {
      id:l.id,
      name:l.name,
      logo:found?.league?.logo || "",
      country:{
        name:l.country,
        code:l.code
      },
      seasons:found?.seasons || [],
      season:current?.year || seasonForDate(todayJakarta())
    };
  });

  return cacheSet(key,output,TTL.standings);
}

function mapStatistics(rows) {
  return (rows || []).map(team=>({
    team:{
      id:team.team?.id,
      name:team.team?.name,
      logo:team.team?.logo
    },
    statistics:(team.statistics || []).map(stat=>({
      name:stat.type,
      displayName:stat.type,
      value:stat.value
    }))
  }));
}

function mapLineups(rows) {
  const mapped = (rows || []).map(item=>({
    id:item.team?.id,
    name:item.team?.name || "Team",
    formation:item.formation || "",
    initialLineup:(item.startXI || []).map(x=>({
      id:x.player?.id,
      name:x.player?.name,
      number:x.player?.number,
      position:x.player?.pos,
      grid:x.player?.grid
    })),
    substitutes:(item.substitutes || []).map(x=>({
      id:x.player?.id,
      name:x.player?.name,
      number:x.player?.number,
      position:x.player?.pos
    }))
  }));

  return {
    homeTeam:mapped[0] || null,
    awayTeam:mapped[1] || null
  };
}

function mapPlayerRatings(rows) {
  return (rows || []).map(team=>({
    team:{
      id:team.team?.id,
      name:team.team?.name
    },
    players:(team.players || []).map(item=>{
      const stats = item.statistics?.[0] || {};
      const games = stats.games || {};

      return {
        id:item.player?.id,
        name:item.player?.name || "Unknown",
        position:games.position || "",
        minutesPlayed:games.minutes ?? null,
        matchRating:games.rating ?? null,
        number:item.player?.number ?? null,
        statistics:stats
      };
    })
  }));
}

async function getMatchDetail(id) {
  const key = `detail:${id}`;
  const saved = cacheGet(key);
  if (saved) return saved;

  const fixtures = await apiFootball("/fixtures",{id});
  if (!fixtures.length) {
    throw new Error("Pertandingan tidak ditemukan di API-Football");
  }

  const results = await Promise.allSettled([
    apiFootball("/fixtures/statistics",{fixture:id}),
    apiFootball("/fixtures/lineups",{fixture:id}),
    apiFootball("/fixtures/players",{fixture:id}),
    apiFootball("/fixtures/events",{fixture:id})
  ]);

  const get = index =>
    results[index].status==="fulfilled"
      ? results[index].value
      : [];

  const detail = {
    fixture:normalizeAFMatch(fixtures[0]),
    statistics:mapStatistics(get(0)),
    lineups:mapLineups(get(1)),
    players:mapPlayerRatings(get(2)),
    events:get(3),
    unavailable:results
      .map((r,i)=>r.status==="rejected"
        ? ["statistics","lineups","players","events"][i]
        : null
      )
      .filter(Boolean),
    provider:"API-Football"
  };

  return cacheSet(key,detail,TTL.details);
}

async function getH2H(team1,team2) {
  if (!team1 || !team2) return [];

  const rows = await apiFootball("/fixtures/headtohead",{
    h2h:`${team1}-${team2}`,
    last:10,
    timezone:"Asia/Jakarta"
  });

  return rows.map(normalizeAFMatch);
}

async function getStandings(leagueId,season) {
  const rows = await apiFootball("/standings",{
    league:leagueId,
    season:season || seasonForDate(todayJakarta())
  },TTL.standings);

  return rows?.[0]?.league?.standings || [];
}

async function getPredictions(fixture) {
  const rows = await apiFootball("/predictions",{fixture});
  return rows[0] || null;
}

async function getStatsBombCompetitions() {
  const url = `${BASE.statsBomb}/data/competitions.json`;
  const data = await fetchJSON(url);

  return data.map(x=>({
    competitionId:x.competition_id,
    seasonId:x.season_id,
    competition:x.competition_name,
    country:x.country_name,
    season:x.season_name
  }));
}

async function route(type,q) {
  const date = q.date || todayJakarta();

  /*
   * Frontend compatibility routes
   */

  if (type==="hl-leagues") {
    return getLeagues();
  }

  if (type==="hl-matches") {
    const leagueId = q.leagueId || q.league || null;
    const result = await getMatches(date,leagueId);
    return result.matches;
  }

  if (type==="hl-match") {
    const id = String(q.id || "");
    if (!/^\d+$/.test(id)) {
      throw new Error("Detail pertandingan hanya tersedia untuk ID API-Football");
    }
    const detail = await getMatchDetail(id);
    return detail.fixture;
  }

  if (type==="hl-statistics") {
    const detail = await getMatchDetail(q.id);
    return detail.statistics;
  }

  if (type==="hl-lineups") {
    const detail = await getMatchDetail(q.id);
    return detail.lineups;
  }

  if (type==="hl-boxscore") {
    const detail = await getMatchDetail(q.id);
    return detail.players;
  }

  if (type==="hl-h2h") {
    return getH2H(q.team1,q.team2);
  }

  /*
   * Legacy routes
   */

  if (type==="home") {
    const [matches,leagues] = await Promise.all([
      getMatches(date),
      getLeagues()
    ]);

    return {
      date,
      matches:matches.matches,
      errors:matches.errors,
      leagues,
      providers:[
        "API-Football",
        "Highlightly",
        "football-data.org",
        "TheSportsDB",
        "OpenLigaDB",
        "OpenFootball",
        "StatsBomb Open Data"
      ]
    };
  }

  if (type==="leagues") return getLeagues();

  if (type==="matches") {
    return getMatches(date,q.league || q.leagueId);
  }

  if (type==="match") return getMatchDetail(q.id);

  if (type==="standings") {
    return getStandings(q.league,q.season);
  }

  if (type==="h2h") return getH2H(q.team1,q.team2);

  if (type==="predictions") return getPredictions(q.fixture);

  if (type==="statsbomb-competitions") {
    return getStatsBombCompetitions();
  }

  throw new Error("Unknown API type: "+type);
}

module.exports = async function handler(req,res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  res.setHeader("Cache-Control","no-store");

  if (req.method==="OPTIONS") {
    return res.status(200).end();
  }

  if (req.method!=="GET") {
    return res.status(405).json({
      ok:false,
      error:"Method not allowed"
    });
  }

  try {
    const q = req.query || {};
    const type = q.type || "home";
    const data = await route(type,q);

    return res.status(200).json({
      ok:true,
      type,
      data
    });
  } catch (error) {
    console.error("[Football Forum API]",error);

    return res.status(500).json({
      ok:false,
      error:error.message || "Internal server error"
    });
  }
};
