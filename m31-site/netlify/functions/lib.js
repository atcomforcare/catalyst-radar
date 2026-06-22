// Shared helpers for the Catalyst Radar Netlify functions.
// No external dependencies — relies on global fetch (Node 18+).

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const FINNHUB = "https://finnhub.io/api/v1";

const SHAPE =
  '{"ticker":"SYMBOL","company":"name","sector":"sector",' +
  '"catalystType":"earnings|ma|layoffs|other",' +
  '"catalyst":"short, specific, current reason it could move (include a date if relevant)",' +
  '"timing":"e.g. next 2-4 weeks",' +
  '"direction":"up|down|volatile","confidence":"Low|Medium|High",' +
  '"estTarget":<your estimated price target in USD, a number>,' +
  '"consensus":"<=12 words","reasoning":"<=12 words"}';

const PREFIX =
  "You are a research assistant for a stock-idea UI. Use web search to ground every name in CURRENT, recent information. " +
  "Do NOT output any current or live stock price — only your own estimated price target (estTarget). " +
  "Never refuse, never apologize, never add prose, notes, or markdown. Output ONLY a raw JSON array and nothing else.";

function jsonResp(code, obj) {
  return {
    statusCode: code,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(obj),
  };
}

// Robust JSON-array extraction with salvage for truncated output.
function extractArray(text) {
  const clean = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = clean.indexOf("[");
  if (start === -1) throw new Error("no JSON array in model output");
  const end = clean.lastIndexOf("]");
  const body = end > start ? clean.slice(start, end + 1) : clean.slice(start);
  try {
    return JSON.parse(body);
  } catch (e) {
    const lastObj = body.lastIndexOf("}");
    if (lastObj > start) return JSON.parse(body.slice(0, lastObj + 1) + "]");
    throw new Error("could not parse model output");
  }
}

function convictionLine(filter) {
  if (filter === "high") return 'Every object must have direction "up" AND confidence "High".';
  if (filter === "all") return "Use the strongest movers; direction may be up, down, or volatile.";
  return 'Every object must have direction "up".';
}

function buildScanPrompt(count, filter, exclude) {
  return (
    PREFIX +
    "\n\nUse web search to find " + count + " US-listed growth stocks (aggressive risk tolerance) likely to RISE " +
    "over roughly the next 4 weeks for ANY reason — upcoming catalysts, earnings, M&A, analyst upgrades, raised guidance, " +
    "momentum, technical breakouts, sector or thematic tailwinds, or shifting sentiment. Do not limit to one category. " +
    'Use catalystType "other" when it is not a discrete event.\n' +
    convictionLine(filter) + "\n" +
    (exclude && exclude.length ? "Avoid these tickers: " + exclude.join(", ") + ".\n" : "") +
    "\nReturn a JSON array of " + count + " objects, each exactly this shape:\n" + SHAPE
  );
}

function buildDivePrompt(ticker) {
  return (
    PREFIX +
    '\n\nUse web search on the single US-listed stock "' + ticker + '". Give its most important, current near-term driver ' +
    "(next ~4 weeks) and the likely price impact, whatever the direction.\n\n" +
    "Return a JSON array containing exactly 1 object of this shape:\n" + SHAPE
  );
}

async function askClaude(prompt, apiKey) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2500,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error((data.error && data.error.message) || ("Anthropic HTTP " + res.status));
  }
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return extractArray(text);
}

async function finnhubQuote(symbol, key) {
  const url = FINNHUB + "/quote?symbol=" + encodeURIComponent(symbol) + "&token=" + key;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Finnhub HTTP " + r.status);
  return r.json(); // { c, d, dp, h, l, o, pc, t }
}

// Merge Claude candidates with real-time Finnhub quotes.
// Drops any name without a valid live quote so a stale/guessed price can never show.
async function enrich(candidates, finnhubKey) {
  const out = [];
  for (const c of candidates) {
    if (!c || !c.ticker) continue;
    let q = null;
    try {
      q = await finnhubQuote(String(c.ticker).toUpperCase(), finnhubKey);
    } catch (e) {
      q = null;
    }
    const price = q && isFinite(q.c) && q.c > 0 ? q.c : null;
    if (price == null) continue; // no real quote -> skip entirely
    const est = Number(c.estTarget);
    const target = isFinite(est) ? est : null;
    const upside = target != null && price ? ((target - price) / price) * 100 : null;
    out.push({
      ticker: String(c.ticker).toUpperCase(),
      company: c.company || "",
      sector: c.sector || "",
      catalystType: c.catalystType || "other",
      catalyst: c.catalyst || "",
      timing: c.timing || "",
      direction: c.direction || "volatile",
      confidence: c.confidence || "Medium",
      price: price,
      target: target,
      upside: upside,
      changePct: q && isFinite(q.dp) ? q.dp : null,
      consensus: c.consensus || "",
      reasoning: c.reasoning || "",
      asOf: q && q.t ? q.t * 1000 : Date.now(),
    });
  }
  return out;
}

module.exports = {
  jsonResp,
  extractArray,
  buildScanPrompt,
  buildDivePrompt,
  askClaude,
  finnhubQuote,
  enrich,
};
