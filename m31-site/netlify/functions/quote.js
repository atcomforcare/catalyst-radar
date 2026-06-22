const { jsonResp, buildDivePrompt, askClaude, enrich } = require("./lib");

exports.handler = async (event) => {
  const A = process.env.ANTHROPIC_API_KEY;
  const F = process.env.FINNHUB_API_KEY;
  if (!A || !F) {
    return jsonResp(500, { error: "Server missing API keys. Set ANTHROPIC_API_KEY and FINNHUB_API_KEY in Netlify." });
  }

  const params = (event.queryStringParameters || {});
  const ticker = String(params.ticker || "").trim().toUpperCase();
  if (!ticker || !/^[A-Z.\-]{1,8}$/.test(ticker)) {
    return jsonResp(400, { error: "Provide a valid ticker, e.g. ?ticker=NVDA" });
  }

  try {
    const candidates = await askClaude(buildDivePrompt(ticker), A);
    const results = await enrich(candidates, F);
    if (!results.length) {
      return jsonResp(404, { error: "No live quote found for " + ticker + " (US-listed only)." });
    }
    return jsonResp(200, { results: results.slice(0, 1), asOf: Date.now() });
  } catch (e) {
    return jsonResp(502, { error: String((e && e.message) || e) });
  }
};
