
export default async function handler(req, res) {
  const token = process.env.SPORTMONKS_API_TOKEN;

  if (!token) {
    return res.status(500).json({
      error: "Sportmonks API token belum dikonfigurasi"
    });
  }

  const allowedTypes = ["livescores", "fixtures", "players"];

  const type = req.query.type || "livescores";

  if (!allowedTypes.includes(type)) {
    return res.status(400).json({
      error: "Jenis data tidak valid"
    });
  }

  let endpoint = "";

  if (type === "livescores") {
    endpoint = "livescores";
  } else if (type === "fixtures") {
    endpoint = "fixtures";
  } else if (type === "players") {
    endpoint = "players";
  }

  try {
    const response = await fetch(
      `https://api.sportmonks.com/v3/football/${endpoint}?api_token=${encodeURIComponent(token)}`
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Sportmonks API request gagal",
        details: data
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({
      error: "Gagal menghubungi Sportmonks"
    });
  }
}
