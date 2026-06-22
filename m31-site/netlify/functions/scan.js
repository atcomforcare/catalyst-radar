const { jsonResp, buildScanPrompt, askClaude, enrich } = require("./lib");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return jsonResp(405, { error: "Use POST." });

  const A = process.env.ANTHROPIC_API_KEY;
  const F = process.env.FINNHUB_API_KEY;
  if (!A || !F) {
    return jsonResp(500, { error: "Server missing API keys. Set ANTHROPIC_API_KEY and FINNHUB_API_KEY in Netlify." });
  }

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { body = {}; }

  const count = Math.min(Math.max(parseInt(body.count, 10) || 10, 1), 12);
  const filter = ["up", "high", "all"].includes(body.filter) ? body.filter : "up";
  const exclude = Array.isArray(body.exclude) ? body.exclude.slice(0, 40) : [];

  try {
    // Ask for a few extra so that names dropped for missing quotes still leave ~count.
    const candidates = await askClaude(buildScanPrompt(count + 2, filter, exclude), A);
    const results = await enrich(candidates, F);
    return jsonResp(200, { results: results.slice(0, count), asOf: Date.now() });
  } catch (e) {
    return jsonResp(502, { error: String((e && e.message) || e) });
  }
};
