
const memoryCache = new Map();

const TTL = {
  leagues: 6 * 60 * 60 * 1000,
  matches: 60 * 1000,
  details: 5 * 60 * 1000
};

function getCache(key) {
  const item = memoryCache.get(key);
  if (!item || Date.now() > item.expires) {
    memoryCache.delete(key);
    return null;
  }
  return item.data;
}

function saveCache(key, data, ttl) {
  memoryCache.set(key, {
    data,
    expires: Date.now() + ttl
  });
}

async function requestJSON(url, headers = {}) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(12000)
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(
      data?.message || `Provider error ${response.status}`
    );
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function cachedRequest(key, ttl, request) {
  const cached = getCache(key);
  if (cached) return cached;

  const data = await request();
  saveCache(key, data, ttl);
  return data;
}

function getJakartaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function sendError(res, error) {
  console.error("FOOTBALL API ERROR:", error);

  return res.status(error.status || 500).json({
    error: "Gagal mengambil data sepak bola",
    message: error.message,
    providerError: error.data || null
  });
}

export default async function handler(req, res) {
  const type = String(req.query.type || "fixtures");
  const source = String(req.query.source || "api-football");

  try {
    // HIGHLIGHTLY
    if (source === "highlightly") {
      const key = process.env.HIGHLIGHTLY_API_KEY;

      if (!key) {
        return res.status(500).json({
          error: "HIGHLIGHTLY_API_KEY belum dipasang di Vercel"
        });
      }

      const params = new URLSearchParams();
      let path = "";

      if (type === "hl-leagues") {
        path = "/leagues";

        if (req.query.season) {
          params.set("season", req.query.season);
        }

        if (req.query.countryCode) {
          params.set("countryCode", req.query.countryCode);
        }
      }

      else if (type === "hl-matches") {
        path = "/matches";

        // Minimal satu parameter wajib diberikan.
        params.set("date", req.query.date || getJakartaDate());

        if (req.query.leagueId) {
          params.set("leagueId", req.query.leagueId);
        }

        if (req.query.countryCode) {
          params.set("countryCode", req.query.countryCode);
        }

        if (req.query.limit) {
          params.set("limit", req.query.limit);
        }
      }

      else if (
        ["hl-statistics", "hl-lineups", "hl-events"].includes(type)
      ) {
        const id = req.query.id;

        if (!id) {
          return res.status(400).json({
            error: "Parameter id wajib diisi"
          });
        }

        const endpoint = {
          "hl-statistics": "statistics",
          "hl-lineups": "lineups",
          "hl-events": "events"
        }[type];

        path = `/${endpoint}/${encodeURIComponent(id)}`;
      }

      else if (type === "hl-h2h") {
        const team1 = req.query.team1;
        const team2 = req.query.team2;

        if (!team1 || !team2) {
          return res.status(400).json({
            error: "Parameter team1 dan team2 wajib diisi"
          });
        }

        path = "/head-2-head";
        params.set("teamIdOne", team1);
        params.set("teamIdTwo", team2);
      }

      else {
        return res.status(400).json({
          error: "Jenis Highlightly tidak valid"
        });
      }

      const query = params.toString();
      const url = `https://soccer.highlightly.net${path}` +
        (query ? `?${query}` : "");

      const ttl = type === "hl-leagues"
        ? TTL.leagues
        : type === "hl-matches"
        ? TTL.matches
        : TTL.details;

      const data = await cachedRequest(
        `highlightly:${url}`,
        ttl,
        () => requestJSON(url, {
          "x-rapidapi-key": key
        })
      );

      res.setHeader(
        "Cache-Control",
        "s-maxage=60, stale-while-revalidate=300"
      );

      return res.status(200).json({
        provider: "Highlightly",
        type,
        data
      });
    }

    // OPENLIGADB
    if (source === "openligadb") {
      const league = req.query.league;
      const season = req.query.season;

      if (!league || !season) {
        return res.status(400).json({
          error: "Parameter league dan season wajib diisi"
        });
      }

      let path;

      if (type === "ol-matches") {
        path = `/getmatchdata/${encodeURIComponent(league)}/${encodeURIComponent(season)}`;
      } else if (type === "ol-table") {
        path = `/getbltable/${encodeURIComponent(league)}/${encodeURIComponent(season)}`;
      } else {
        return res.status(400).json({
          error: "Jenis OpenLigaDB tidak valid"
        });
      }

      const url = `https://api.openligadb.de${path}`;

      const data = await cachedRequest(
        `openligadb:${url}`,
        TTL.matches,
        () => requestJSON(url)
      );

      return res.status(200).json({
        provider: "OpenLigaDB",
        type,
        data
      });
    }

    // API-FOOTBALL
    if (source !== "api-football") {
      return res.status(400).json({
        error: "Sumber API tidak dikenal"
      });
    }

    const apiKey = process.env.API_FOOTBALL_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "API_FOOTBALL_KEY belum dipasang"
      });
    }

    const endpoints = {
      leagues: "leagues",
      fixtures: "fixtures",
      livescores: "fixtures",
      fixture: "fixtures",
      statistics: "fixtures/statistics",
      lineups: "fixtures/lineups",
      players: "fixtures/players",
      h2h: "fixtures/headtohead",
      predictions: "predictions"
    };

    if (!endpoints[type]) {
      return res.status(400).json({
        error: "Jenis API-Football tidak valid"
      });
    }

    const url = new URL(
      `https://v3.football.api-sports.io/${endpoints[type]}`
    );

    const params = {
      timezone: "Asia/Jakarta"
    };

    if (type === "leagues") {
      params.current = "true";
    }

    if (type === "fixtures") {
      params.date = req.query.date || getJakartaDate();
      params.league = req.query.league;
      params.season = req.query.season;
    }

    if (type === "livescores") {
      params.live = "all";
    }

    if (type === "fixture") {
      params.id = req.query.id;
    }

    if (
      ["statistics", "lineups", "players", "predictions"].includes(type)
    ) {
      params.fixture = req.query.fixture;
    }

    if (type === "h2h") {
      params.h2h = req.query.h2h;
      params.last = req.query.last || "10";
    }

    const required = {
      fixture: "id",
      statistics: "fixture",
      lineups: "fixture",
      players: "fixture",
      predictions: "fixture",
      h2h: "h2h"
    };

    if (required[type] && !req.query[required[type]]) {
      return res.status(400).json({
        error: `Parameter ${required[type]} wajib diisi`
      });
    }

    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(name, String(value));
      }
    }

    const data = await cachedRequest(
      `api-football:${url}`,
      type === "leagues" ? TTL.leagues : TTL.matches,
      () => requestJSON(url.toString(), {
        "x-apisports-key": apiKey
      })
    );

    return res.status(200).json({
      provider: "API-Football",
      data
    });

  } catch (error) {
    return sendError(res, error);
  }
}
