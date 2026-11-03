const BASE = "https://v3.football.api-sports.io";
const cache = new Map();

const TTL = {
  live: 15000,
  home: 30000,
  matches: 60000,
  leagues: 3600000,
  standings: 300000,
  detail: 30000,
  h2h: 300000
};

function send(res, status, body) {
  res.status(status).json(body);
}

async function api(path, params = {}) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("API_FOOTBALL_KEY belum diatur di Vercel.");

  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, String(v));
    }
  });

  const cacheKey = url.toString();
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.time < (TTL[path.includes("headtohead") ? "h2h" : path.includes("standings") ? "standings" : path.includes("leagues") ? "leagues" : path.includes("fixtures") ? "detail" : "matches"] || 30000)) {
    return cached.data;
  }

  const response = await fetch(url, {
    headers: { "x-apisports-key": key }
  });

  const data = await response.json();

  if (!response.ok || data.errors && Object.keys(data.errors).length) {
    const message = typeof data.errors === "object"
      ? JSON.stringify(data.errors)
      : `API mengembalikan status ${response.status}`;
    throw new Error(message);
  }

  cache.set(cacheKey, { time: Date.now(), data });
  return data;
}

function seasonNow() {
  const now = new Date();
  return now.getUTCMonth() >= 6
    ? now.getUTCFullYear()
    : now.getUTCFullYear() - 1;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return send(res, 405, { ok: false, error: "Method tidak didukung." });

  try {
    const q = req.query || {};
    const type = q.type || "home";
    const season = Number(q.season) || seasonNow();

    let result;

    if (type === "home") {
      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Jakarta"
      });

      const [live, todayMatches, upcoming] = await Promise.all([
        api("/fixtures", { live: "all", timezone: "Asia/Jakarta" }),
        api("/fixtures", { date: today, timezone: "Asia/Jakarta" }),
        api("/fixtures", { next: 20, timezone: "Asia/Jakarta" })
      ]);

      result = {
        live: live.response || [],
        today: todayMatches.response || [],
        upcoming: upcoming.response || [],
        errors: [live, todayMatches, upcoming].flatMap(x => x.errors || [])
      };
    }

    else if (type === "matches") {
      const params = {
        date: q.date || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
        timezone: "Asia/Jakarta",
        league: q.league || undefined,
        season
      };
      const data = await api("/fixtures", params);
      result = data.response || [];
    }

    else if (type === "leagues") {
      const data = await api("/leagues", {
        season,
        current: "true"
      });
      result = data.response || [];
    }

    else if (type === "standings") {
      if (!q.league) return send(res, 400, { ok: false, error: "ID liga belum diberikan." });
      const data = await api("/standings", {
        league: q.league,
        season
      });
      result = data.response || [];
    }

    else if (type === "detail") {
      if (!q.fixture) return send(res, 400, { ok: false, error: "ID pertandingan belum diberikan." });
      const data = await api("/fixtures", { id: q.fixture });
      result = data.response?.[0] || null;
    }

    else if (type === "h2h") {
      if (!q.home || !q.away) {
        return send(res, 400, { ok: false, error: "ID kedua tim diperlukan." });
      }
      const data = await api("/fixtures/headtohead", {
        h2h: `${q.home}-${q.away}`,
        last: 10,
        timezone: "Asia/Jakarta"
      });
      result = data.response || [];
    }

    else {
      return send(res, 400, { ok: false, error: "Tipe data tidak dikenal." });
    }

    return send(res, 200, { ok: true, data: result });
  } catch (error) {
    console.error("Football API error:", error);
    return send(res, 500, {
      ok: false,
      error: error.message || "Gagal mengambil data pertandingan."
    });
  }
}
