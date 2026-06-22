// Background function (note the "-background" suffix): runs up to 15 min,
// returns 202 immediately, and writes its result to Netlify Blobs for polling.
const { getStore } = require("@netlify/blobs");
const { buildScanPrompt, buildDivePrompt, askClaude, enrich } = require("./lib");

exports.handler = async (event) => {
  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { body = {}; }
  const jobId = body.jobId;
  if (!jobId) return; // nothing to track

  const store = getStore("catalyst-jobs");
  const A = process.env.ANTHROPIC_API_KEY;
  const F = process.env.FINNHUB_API_KEY;

  try {
    if (!A || !F) {
      await store.setJSON(jobId, { status: "error", error: "Server missing API keys. Set ANTHROPIC_API_KEY and FINNHUB_API_KEY in Netlify." });
      return;
    }

    let results = [];
    if (body.mode === "dive") {
      const t = String(body.ticker || "").trim().toUpperCase();
      if (!t || !/^[A-Z.\-]{1,8}$/.test(t)) {
        await store.setJSON(jobId, { status: "error", error: "Please enter a valid ticker." });
        return;
      }
      const cands = await askClaude(buildDivePrompt(t), A);
      results = (await enrich(cands, F)).slice(0, 1);
      if (!results.length) {
        await store.setJSON(jobId, { status: "error", error: "Couldn't get a live quote for " + t + " (US-listed only)." });
        return;
      }
    } else {
      const count = Math.min(Math.max(parseInt(body.count, 10) || 10, 1), 12);
      const filter = ["up", "high", "all"].includes(body.filter) ? body.filter : "up";
      const exclude = Array.isArray(body.exclude) ? body.exclude.slice(0, 40) : [];
      const cands = await askClaude(buildScanPrompt(count + 2, filter, exclude), A);
      results = (await enrich(cands, F)).slice(0, count);
      if (!results.length) {
        await store.setJSON(jobId, { status: "error", error: "No live names surfaced this time. Try again." });
        return;
      }
    }

    await store.setJSON(jobId, { status: "done", results: results, asOf: Date.now() });
  } catch (e) {
    try {
      await store.setJSON(jobId, { status: "error", error: String((e && e.message) || e) });
    } catch (_) {}
  }
};
