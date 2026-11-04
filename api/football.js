"use strict";

/*
 * FOOTBALL FORUM - MULTI API BACKEND
 * Providers:
 * 1. API-Football
 * 2. FootyStats
 * 3. Highlightly
 * 4. football-data.org
 * 5. TheSportsDB
 * 6. OpenLigaDB
 * 7. OpenFootball
 * 8. StatsBomb Open Data
 */

const BASE = {
  apiFootball: "https://v3.football.api-sports.io",
  footystats: "https://api.football-data-api.com",
  highlightly: "https://soccer.highlightly.net",
  footballData: "https://api.football-data.org/v4",
  sportsDB: "https://www.thesportsdb.com/api/v1/json",
  openLiga: "https://api.openligadb.de",
  openFootball: "https://raw.githubusercontent.com/openfootball/football.json/master",
  statsBomb: "https://raw.githubusercontent.com/statsbomb/open-data/master"
};

const cache = new Map();

const TTL = {
  live: 25000,
  matches: 120000,
  details: 60000,
  standings: 1200000,
  logos: 86400000,
  archive: 86400000
};

const LEAGUES = [
  {name:"Premier League",country:"England",flag:"🏴",api:39,fd:"PL",open:"en.1"},
  {name:"Championship",country:"England",flag:"🏴",api:40,fd:"ELC",open:"en.2"},
  {name:"League One",country:"England",flag:"🏴",api:41,fd:"",open:"en.3"},
  {name:"League Two",country:"England",flag:"🏴",api:42,fd:"",open:"en.4"},
  {name:"La Liga",country:"Spain",flag:"🇪🇸",api:140,fd:"PD",open:"es.1"},
  {name:"Segunda División",country:"Spain",flag:"🇪🇸",api:141,fd:"SD",open:"es.2"},
  {name:"Serie A",country:"Italy",flag:"🇮🇹",api:135,fd:"SA",open:"it.1"},
  {name:"Serie B",country:"Italy",flag:"🇮🇹",api:136,fd:"SB",open:"it.2"},
  {name:"Bundesliga",country:"Germany",flag:"🇩🇪",api:78,fd:"BL1",open:"de.1",openLiga:"bl1"},
  {name:"2. Bundesliga",country:"Germany",flag:"🇩🇪",api:79,fd:"BL2",open:"de.2",openLiga:"bl2"},
  {name:"3. Liga",country:"Germany",flag:"🇩🇪",api:80,fd:"",open:"de.3",openLiga:"bl3"},
  {name:"Ligue 1",country:"France",flag:"🇫🇷",api:61,fd:"FL1",open:"fr.1"},
  {name:"Ligue 2",country:"France",flag:"🇫🇷",api:62,fd:"FL2",open:"fr.2"},
  {name:"Eredivisie",country:"Netherlands",flag:"🇳🇱",api:88,fd:"DED",open:"nl.1"},
  {name:"Primeira Liga",country:"Portugal",flag:"🇵🇹",api:94,fd:"PPL",open:"pt.1"},
  {name:"Brasileirão Série A",country:"Brazil",flag:"🇧🇷",api:71,fd:"BSA",open:"br.1"},
  {name:"MLS",country:"USA",flag:"🇺🇸",api:253,fd:"MLS",open:"us.1"},
  {name:"UEFA Champions League",country:"Europe",flag:"🇪🇺",api:2,fd:"CL",open:null},
  {name:"UEFA Europa League",country:"Europe",flag:"🇪🇺",api:3,fd:"EL",open:null},
  {name:"UEFA Conference League",country:"Europe",flag:"🇪🇺",api:848,fd:"",open:null}
];

function getCache(key) {
  const item = cache.get(key);
  if (!item || item.expires < Date.now()) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function setCache(key,value,ttl) {
  cache.set(key,{value,expires:Date.now()+ttl});
  return value;
}

async function requestJSON(url,headers={},timeout=10000) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),timeout);

  try {
    const response = await fetch(url,{
      headers,
      signal:controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function queryString(params) {
  const search = new URLSearchParams();

  for (const [key,value] of Object.entries(params||{})) {
    if (value!==undefined && value!==null && value!=="") {
      search.set(key,String(value));
    }
  }

  return search.toString();
}

async function apiFootball(path,params={},ttl=TTL.details) {
  if (!process.env.API_FOOTBALL_KEY) {
    throw new Error("API_FOOTBALL_KEY belum dipasang");
  }

  const qs = queryString(params);
  const url = `${BASE.apiFootball}${path}${qs?"?"+qs:""}`;
  const key = `af:${url}`;
  const saved = getCache(key);

  if (saved) return saved;

  const data = await requestJSON(url,{
    "x-apisports-key":process.env.API_FOOTBALL_KEY
  });

  if (data.errors && Object.keys(data.errors).length) {
    throw new Error(JSON.stringify(data.errors));
  }

  return setCache(key,data.response||[],ttl);
}

async function highlightly(path,params={},ttl=TTL.details) {
  if (!process.env.HIGHLIGHTLY_API_KEY) {
    throw new Error("HIGHLIGHTLY_API_KEY belum dipasang");
  }

  const qs = queryString(params);
  const url = `${BASE.highlightly}${path}${qs?"?"+qs:""}`;
  const key = `hl:${url}`;
  const saved = getCache(key);

  if (saved) return saved;

  const data = await requestJSON(url,{
    "x-rapidapi-key":process.env.HIGHLIGHTLY_API_KEY
  });

  const result = Array.isArray(data)
    ? data
    : (data.data||data.results||[]);

  return setCache(key,result,ttl);
}

async function footballData(path,params={},ttl=TTL.matches) {
  if (!process.env.FOOTBALL_DATA_KEY) {
    throw new Error("FOOTBALL_DATA_KEY belum dipasang");
  }

  const qs = queryString(params);
  const url = `${BASE.footballData}${path}${qs?"?"+qs:""}`;
  const key = `fd:${url}`;
  const saved = getCache(key);

  if (saved) return saved;

  const data = await requestJSON(url,{
    "X-Auth-Token":process.env.FOOTBALL_DATA_KEY
  });

  return setCache(key,data,ttl);
}

async function footyStats(path,params={},ttl=TTL.details) {
  const token = process.env.FOOTYSTATS_API_KEY;

  if (!token) return null;

  const qs = queryString({...params,key:token});
  const url = `${BASE.footystats}${path}${qs?"?"+qs:""}`;
  const key = `fs:${url}`;
  const saved = getCache(key);

  if (saved) return saved;

  const data = await requestJSON(url);

  if (data.success===false) {
    throw new Error(data.message||"FootyStats request failed");
  }

  return setCache(key,data.data??data,ttl);
}

function cleanTeamName(value) {
  return String(value||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]/g,"");
}

async function getFootyStatsForFixture(fixture) {
  if (!process.env.FOOTYSTATS_API_KEY || !fixture?.date) return null;

  const date = String(fixture.date).slice(0,10);

  const rows = await footyStats("/todays-matches",{
    date,
    timezone:"Asia/Jakarta"
  },TTL.matches);

  const list = Array.isArray(rows)?rows:[];
  const home = cleanTeamName(fixture.home);
  const away = cleanTeamName(fixture.away);

  const found = list.find(row =>
    cleanTeamName(row.home_name)===home &&
    cleanTeamName(row.away_name)===away
  );

  if (!found?.id) return null;

  return await footyStats("/match",{
    match_id:found.id
  },TTL.details);
}

function mapFootyStatsStatistics(match) {
  if (!match || typeof match!=="object") return [];

  const pair = (label,homeKey,awayKey,suffix="") => ({
    type:label,
    home:match[homeKey]==null || Number(match[homeKey])<0
      ? null
      : `${match[homeKey]}${suffix}`,
    away:match[awayKey]==null || Number(match[awayKey])<0
      ? null
      : `${match[awayKey]}${suffix}`
  });

  const values = [
    pair("Ball Possession","team_a_possession","team_b_possession","%"),
    pair("Expected Goals","team_a_xg_prematch","team_b_xg_prematch"),
    pair("Total Shots","team_a_shots","team_b_shots"),
    pair("Shots on Goal","team_a_shotsOnTarget","team_b_shotsOnTarget"),
    pair("Shots off Goal","team_a_shotsOffTarget","team_b_shotsOffTarget"),
    pair("Corner Kicks","team_a_corners","team_b_corners"),
    pair("Offsides","team_a_offsides","team_b_offsides"),
    pair("Fouls","team_a_fouls","team_b_fouls"),
    pair("Yellow Cards","team_a_yellow_cards","team_b_yellow_cards"),
    pair("Red Cards","team_a_red_cards","team_b_red_cards")
  ];

  return [
    {
      statistics:values
        .filter(x=>x.home!==null||x.away!==null)
        .map(x=>({type:x.type,value:x.home}))
    },
    {
      statistics:values
        .filter(x=>x.home!==null||x.away!==null)
        .map(x=>({type:x.type,value:x.away}))
    }
  ];
}

function sportsDBKey() {
  return process.env.THESPORTSDB_API_KEY||"123";
}

async function sportsDB(path,params={},ttl=TTL.details) {
  const qs = queryString(params);
  const url = `${BASE.sportsDB}/${sportsDBKey()}/${path}${qs?"?"+qs:""}`;
  const key = `tsdb:${url}`;
  const saved = getCache(key);

  if (saved) return saved;

  const data = await requestJSON(url);
  return setCache(key,data,ttl);
}

async function openLiga(path,ttl=TTL.matches) {
  const url = `${BASE.openLiga}${path}`;
  const key = `ol:${url}`;
  const saved = getCache(key);

  if (saved) return saved;

  const data = await requestJSON(url);
  return setCache(key,data,ttl);
}

async function openFootballFile(season,file) {
  const url = `${BASE.openFootball}/${season}/${file}.json`;
  const key = `of:${url}`;
  const saved = getCache(key);

  if (saved) return saved;

  const data = await requestJSON(url);
  return setCache(key,data,TTL.archive);
}

async function statsBombFile(path) {
  const url = `${BASE.statsBomb}/${path}`;
  const key = `sb:${url}`;
  const saved = getCache(key);

  if (saved) return saved;

  const data = await requestJSON(url);
  return setCache(key,data,TTL.archive);
}

function seasonStart(date=new Date()) {
  const year = date.getUTCFullYear();
  return date.getUTCMonth()>=6?year:year-1;
}

function currentSeason() {
  return seasonStart();
}

function dateToday() {
  return new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Jakarta",
    year:"numeric",
    month:"2-digit",
    day:"2-digit"
  }).format(new Date());
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value&&Array.isArray(value.data)) return value.data;
  if (value&&Array.isArray(value.response)) return value.response;
  return [];
}

function mapAFMatch(item) {
  const fixture = item.fixture||{};
  const teams = item.teams||{};
  const goals = item.goals||{};
  const league = item.league||{};
  const status = fixture.status||{};
  const short = status.short||"";

  return {
    id:String(fixture.id),
    provider:"API-Football",
    providerId:String(fixture.id),
    date:fixture.date,
    timestamp:fixture.timestamp,
    status:status.long||short,
    statusShort:short,
    elapsed:status.elapsed,
    live:["1H","HT","2H","ET","P","LIVE","BT"].includes(short),
    finished:["FT","AET","PEN"].includes(short),
    home:teams.home?.name||"Home",
    away:teams.away?.name||"Away",
    homeId:teams.home?.id,
    awayId:teams.away?.id,
    homeLogo:teams.home?.logo||null,
    awayLogo:teams.away?.logo||null,
    homeScore:goals.home,
    awayScore:goals.away,
    league:league.name||"",
    leagueId:league.id,
    country:league.country||"",
    season:league.season,
    round:league.round||""
  };
}

function mapHighlightlyMatch(item) {
  const home = item.homeTeam||item.home||{};
  const away = item.awayTeam||item.away||{};
  const league = item.league||{};

  const homeName = typeof home==="string"?home:home.name;
  const awayName = typeof away==="string"?away:away.name;

  const status = item.status||{};
  const statusText = typeof status==="string"
    ? status
    : (status.name||status.description||"");

  return {
    id:`hl:${item.id||item.matchId}`,
    provider:"Highlightly",
    providerId:String(item.id||item.matchId||""),
    date:item.date||item.startDate||item.dateUtc,
    status:statusText,
    statusShort:status.shortName||"",
    live:Boolean(item.isLive||status.isLive),
    finished:Boolean(item.isFinished||status.isFinished),
    home:homeName||"Home",
    away:awayName||"Away",
    homeId:home.id,
    awayId:away.id,
    homeLogo:home.logo||home.image||null,
    awayLogo:away.logo||away.image||null,
    homeScore:item.homeScore?.current??item.score?.home??null,
    awayScore:item.awayScore?.current??item.score?.away??null,
    league:league.name||item.leagueName||"",
    leagueId:league.id,
    country:league.country||"",
    season:item.season
  };
}

function mapFootballDataMatch(item) {
  const score = item.score?.fullTime||{};

  return {
    id:`fd:${item.id}`,
    provider:"football-data.org",
    providerId:String(item.id),
    date:item.utcDate,
    status:item.status,
    live:["IN_PLAY","PAUSED"].includes(item.status),
    finished:["FINISHED","AWARDED"].includes(item.status),
    home:item.homeTeam?.name||"Home",
    away:item.awayTeam?.name||"Away",
    homeId:item.homeTeam?.id,
    awayId:item.awayTeam?.id,
    homeLogo:item.homeTeam?.crest||null,
    awayLogo:item.awayTeam?.crest||null,
    homeScore:score.home??null,
    awayScore:score.away??null,
    league:item.competition?.name||"",
    leagueId:item.competition?.id,
    country:item.area?.name||"",
    season:item.season?.startDate?.slice(0,4)
  };
}

function mapOpenLigaMatch(item) {
  const results = item.matchResults||[];
  const final = results.find(x=>x.resultTypeID===2)||results[results.length-1];

  return {
    id:`ol:${item.matchID}`,
    provider:"OpenLigaDB",
    providerId:String(item.matchID),
    date:item.matchDateTimeUTC||item.matchDateTime,
    status:item.matchIsFinished?"Finished":"Scheduled",
    live:false,
    finished:Boolean(item.matchIsFinished),
    home:item.team1?.teamName||"Home",
    away:item.team2?.teamName||"Away",
    homeId:item.team1?.teamId,
    awayId:item.team2?.teamId,
    homeLogo:item.team1?.teamIconUrl||null,
    awayLogo:item.team2?.teamIconUrl||null,
    homeScore:final?.pointsTeam1??null,
    awayScore:final?.pointsTeam2??null,
    league:item.leagueName||"Bundesliga",
    leagueId:item.leagueId,
    country:"Germany",
    season:item.leagueSeason
  };
}

function mapOpenFootballMatch(item,league) {
  const score = item.score?.ft||item.score?.regular||null;

  return {
    id:`of:${league.open}:${item.date}:${item.team1}:${item.team2}`,
    provider:"OpenFootball",
    providerId:null,
    date:item.date,
    status:score?"Finished":"Scheduled",
    live:false,
    finished:Boolean(score),
    home:item.team1,
    away:item.team2,
    homeId:null,
    awayId:null,
    homeLogo:null,
    awayLogo:null,
    homeScore:score?.[0]??null,
    awayScore:score?.[1]??null,
    league:league.name,
    leagueId:league.api,
    country:league.country,
    season:currentSeason()
  };
}

function sortMatches(matches) {
  return matches.sort((a,b)=>new Date(a.date)-new Date(b.date));
}

function dedupeMatches(matches) {
  const seen = new Set();

  return matches.filter(match=>{
    const key=[
      String(match.date||"").slice(0,10),
      (match.home||"").toLowerCase(),
      (match.away||"").toLowerCase()
    ].join("|");

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getAFToday(date) {
  const rows = await apiFootball("/fixtures",{
    date,
    timezone:"Asia/Jakarta"
  },TTL.live);

  return rows.map(mapAFMatch);
}

async function getHighlightlyMatches(date) {
  const rows = await highlightly("/matches",{date},TTL.live);
  return rows.map(mapHighlightlyMatch);
}

async function getFootballDataMatches(date) {
  const rows = await footballData("/matches",{
    dateFrom:date,
    dateTo:date
  });

  return (rows.matches||[]).map(mapFootballDataMatch);
}

async function getSportsDBMatches(date) {
  const rows = await sportsDB("eventsday.php",{
    d:date,
    s:"Soccer"
  },TTL.matches);

  return (rows.events||[]).map(event=>({
    id:`tsdb:${event.idEvent}`,
    provider:"TheSportsDB",
    providerId:String(event.idEvent),
    date:event.strTimestamp||`${event.dateEvent||date}T${event.strTime||"00:00:00"}`,
    status:event.strStatus||"Scheduled",
    live:/live/i.test(event.strStatus||""),
    finished:/match finished|finished/i.test(event.strStatus||""),
    home:event.strHomeTeam||"Home",
    away:event.strAwayTeam||"Away",
    homeId:null,
    awayId:null,
    homeLogo:event.strHomeTeamBadge||null,
    awayLogo:event.strAwayTeamBadge||null,
    homeScore:event.intHomeScore==null?null:Number(event.intHomeScore),
    awayScore:event.intAwayScore==null?null:Number(event.intAwayScore),
    league:event.strLeague||"",
    leagueId:event.idLeague,
    country:event.strCountry||"",
    season:event.strSeason
  }));
}

async function getOpenLigaMatches(date,league) {
  const year = Number(date.slice(0,4));
  const season = new Date(date).getMonth()<6?year-1:year;
  const rows = await openLiga(`/getmatchdata/${league.openLiga}/${season}`);
  return rows.map(mapOpenLigaMatch).filter(m=>m.date?.slice(0,10)===date);
}

async function getOpenFootballMatches(date) {
  const start = currentSeason();
  const season = `${start}-${String(start+1).slice(-2)}`;

  const candidates = LEAGUES.filter(x=>x.open);

  const responses = await Promise.allSettled(
    candidates.map(async league=>{
      const data = await openFootballFile(season,league.open);

      return (data.matches||[])
        .filter(match=>match.date===date)
        .map(match=>mapOpenFootballMatch(match,league));
    })
  );

  return responses.flatMap(result=>
    result.status==="fulfilled"?result.value:[]
  );
}

async function getMatches(date,leagueId) {
  const cacheKey = `matches:${date}:${leagueId||"all"}`;
  const saved = getCache(cacheKey);

  if (saved) return saved;

  const errors = [];
  let rows = [];

  try {
    rows = await getAFToday(date);
  } catch(error) {
    errors.push(`API-Football: ${error.message}`);
  }

  if (!rows.length) {
    try {
      rows = await getHighlightlyMatches(date);
    } catch(error) {
      errors.push(`Highlightly: ${error.message}`);
    }
  }

  if (!rows.length) {
    try {
      rows = await getFootballDataMatches(date);
    } catch(error) {
      errors.push(`football-data.org: ${error.message}`);
    }
  }

  if (!rows.length) {
    try {
      rows = await getSportsDBMatches(date);
    } catch(error) {
      errors.push(`TheSportsDB: ${error.message}`);
    }
  }

  if (!rows.length) {
    const german = LEAGUES.filter(x=>x.openLiga);
    const results = await Promise.allSettled(
      german.map(x=>getOpenLigaMatches(date,x))
    );
    rows = results.flatMap(x=>x.status==="fulfilled"?x.value:[]);
  }

  if (!rows.length) {
    try {
      rows = await getOpenFootballMatches(date);
    } catch(error) {
      errors.push(`OpenFootball: ${error.message}`);
    }
  }

  if (leagueId) {
    rows = rows.filter(x=>String(x.leagueId)===String(leagueId));
  }

  rows = sortMatches(dedupeMatches(rows));

  return setCache(cacheKey,{
    matches:rows,
    errors,
    provider:rows[0]?.provider||null
  },TTL.matches);
}

async function getLeagues() {
  const key = "leagues:catalog";
  const saved = getCache(key);

  if (saved) return saved;

  let apiRows = [];

  try {
    apiRows = await apiFootball("/leagues",{
      current:"true"
    },TTL.standings);
  } catch(_) {}

  const catalog = LEAGUES.map(league=>{
    const found = apiRows.find(x=>
      Number(x.league?.id)===Number(league.api)
    );

    return {
      id:league.api,
      name:league.name,
      country:league.country,
      flag:league.flag,
      code:league.fd,
      season:found?.seasons?.find(s=>s.current)?.year||currentSeason(),
      logo:found?.league?.logo||null,
      provider:found?"API-Football":"Static catalog"
    };
  });

  return setCache(key,catalog,TTL.standings);
}

async function getStandings(leagueId,season) {
  const key = `standings:${leagueId}:${season}`;
  const saved = getCache(key);

  if (saved) return saved;

  const errors = [];

  try {
    const data = await apiFootball("/standings",{
      league:leagueId,
      season
    },TTL.standings);

    const table = data?.[0]?.league?.standings||[];

    if (table.length) {
      return setCache(key,{
        standings:table,
        provider:"API-Football",
        errors
      },TTL.standings);
    }
  } catch(error) {
    errors.push(error.message);
  }

  const league = LEAGUES.find(x=>Number(x.api)===Number(leagueId));

  if (league?.fd) {
    try {
      const data = await footballData(
        `/competitions/${league.fd}/standings`,
        {season},
        TTL.standings
      );

      if (data.standings?.length) {
        return setCache(key,{
          standings:data.standings.map(group=>
            group.table.map(item=>({
              rank:item.position,
              team:{
                name:item.team?.name,
                logo:item.team?.crest
              },
              all:{
                played:item.playedGames,
                win:item.won,
                draw:item.draw,
                lose:item.lost
              },
              goalsDiff:item.goalDifference,
              points:item.points
            }))
          ),
          provider:"football-data.org",
          errors
        },TTL.standings);
      }
    } catch(error) {
      errors.push(error.message);
    }
  }

  return {standings:[],provider:null,errors};
}

async function getMatch(id) {
  const idText = String(id);
  const key = `match:${idText}`;
  const saved = getCache(key);

  if (saved) return saved;

  const [provider,providerId] = idText.includes(":")
    ? [idText.split(":")[0],idText.slice(idText.indexOf(":")+1)]
    : ["af",idText];

  if (provider==="af"||/^\d+$/.test(idText)) {
    const fixture = await apiFootball("/fixtures",{
      id:providerId
    });

    if (!fixture.length) {
      throw new Error("Pertandingan tidak ditemukan");
    }

    const [lineups,stats,players,events] = await Promise.allSettled([
      apiFootball("/fixtures/lineups",{fixture:providerId}),
      apiFootball("/fixtures/statistics",{fixture:providerId}),
      apiFootball("/fixtures/players",{fixture:providerId}),
      apiFootball("/fixtures/events",{fixture:providerId})
    ]);

    const mappedFixture = mapAFMatch(fixture[0]);

    let footystats = null;

    try {
      footystats = await getFootyStatsForFixture(mappedFixture);
    } catch(error) {
      console.warn("FootyStats unavailable:",error.message);
    }

    const apiStats = stats.status==="fulfilled"?stats.value:[];

    const data = {
      fixture:mappedFixture,
      statistics:apiStats.length
        ? apiStats
        : mapFootyStatsStatistics(footystats),
      footystats,
      lineups:lineups.status==="fulfilled"?lineups.value:[],
      players:players.status==="fulfilled"?players.value:[],
      events:events.status==="fulfilled"?events.value:[],
      provider:"API-Football",
      unavailable:[]
    };

    for (const [name,result] of [
      ["statistics",stats],
      ["lineups",lineups],
      ["players",players],
      ["events",events]
    ]) {
      if (result.status==="rejected") {
        data.unavailable.push(name);
      }
    }

    return setCache(key,data,TTL.details);
  }

  if (provider==="hl") {
    const [statistics,lineups,events] = await Promise.allSettled([
      highlightly(`/statistics/${providerId}`),
      highlightly(`/lineups/${providerId}`),
      highlightly(`/live-events/${providerId}`)
    ]);

    return setCache(key,{
      fixture:null,
      statistics:statistics.status==="fulfilled"?statistics.value:[],
      lineups:lineups.status==="fulfilled"?lineups.value:[],
      players:[],
      events:events.status==="fulfilled"?events.value:[],
      provider:"Highlightly",
      unavailable:[]
    },TTL.details);
  }

  if (provider==="tsdb") {
    const [event,lineup,timeline] = await Promise.allSettled([
      sportsDB("lookupevent.php",{id:providerId}),
      sportsDB("lookuplineup.php",{id:providerId}),
      sportsDB("lookuptimeline.php",{id:providerId})
    ]);

    return setCache(key,{
      fixture:null,
      statistics:[],
      lineups:lineup.status==="fulfilled"?lineup.value.lineup||[]:[],
      players:[],
      events:timeline.status==="fulfilled"?timeline.value.timeline||[]:[],
      event:event.status==="fulfilled"?event.value.events?.[0]:null,
      provider:"TheSportsDB",
      unavailable:[]
    },TTL.details);
  }

  throw new Error(
    "Detail pertandingan untuk provider ini belum mendukung statistik live."
  );
}

async function getH2H(team1,team2) {
  const rows = await apiFootball("/fixtures/headtohead",{
    h2h:`${team1}-${team2}`,
    last:10,
    timezone:"Asia/Jakarta"
  });

  return rows.map(mapAFMatch);
}

async function getTeamForm(team,season) {
  const rows = await apiFootball("/fixtures",{
    team,
    last:5,
    season,
    timezone:"Asia/Jakarta"
  });

  return rows.map(mapAFMatch);
}

async function getTeamLogo(name) {
  const key = `logo:${name.toLowerCase()}`;
  const saved = getCache(key);

  if (saved) return saved;

  try {
    const data = await sportsDB("searchteams.php",{
      t:name
    },TTL.logos);

    const team = data.teams?.[0];

    return setCache(key,{
      name:team?.strTeam||name,
      badge:team?.strBadge||team?.strTeamBadge||null,
      logo:team?.strTeamLogo||null,
      provider:"TheSportsDB"
    },TTL.logos);
  } catch(_) {
    return {
      name,
      badge:null,
      logo:null,
      provider:null
    };
  }
}

async function getStatsBombArchive() {
  const competitions = await statsBombFile("data/competitions.json");

  return competitions.map(item=>({
    competitionId:item.competition_id,
    seasonId:item.season_id,
    competition:item.competition_name,
    country:item.country_name,
    season:item.season_name,
    provider:"StatsBomb Open Data"
  }));
}

async function getStatsBombMatches(competitionId,seasonId) {
  return statsBombFile(
    `data/matches/${competitionId}/${seasonId}.json`
  );
}

async function getHome(date) {
  const [matchesResult,leaguesResult,postersResult] = await Promise.allSettled([
    getMatches(date),
    getLeagues(),
    getOpenFootballMatches(date)
  ]);

  const matchData = matchesResult.status==="fulfilled"
    ? matchesResult.value
    : {
        matches:[],
        errors:[matchesResult.reason?.message]
      };

  return {
    date,
    matches:matchData.matches,
    errors:matchData.errors||[],
    leagues:leaguesResult.status==="fulfilled"
      ? leaguesResult.value
      : [],
    posters:postersResult.status==="fulfilled"
      ? postersResult.value
      : [],
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

module.exports = async function handler(req,res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");

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
    const q = req.query||{};
    const type = q.type||"home";
    const date = q.date||dateToday();

    let data;

    switch(type) {
      case "home":
        data = await getHome(date);
        break;

      case "leagues":
        data = await getLeagues();
        break;

      case "matches":
        data = await getMatches(date,q.league);
        break;

      case "standings":
        data = await getStandings(
          q.league,
          q.season||currentSeason()
        );
        break;

      case "match":
        data = await getMatch(q.id);
        break;

      case "h2h":
        data = await getH2H(q.team1,q.team2);
        break;

      case "team-form":
        data = await getTeamForm(
          q.team,
          q.season||currentSeason()
        );
        break;

      case "team-logo":
        data = await getTeamLogo(q.name);
        break;

      case "statsbomb-competitions":
        data = await getStatsBombArchive();
        break;

      case "statsbomb-matches":
        data = await getStatsBombMatches(
          q.competition,
          q.season
        );
        break;

      default:
        return res.status(400).json({
          ok:false,
          error:"Unknown API type"
        });
    }

    return res.status(200).json({
      ok:true,
      type,
      data
    });

  } catch(error) {
    return res.status(500).json({
      ok:false,
      error:error.message||"Internal server error"
    });
  }
};
