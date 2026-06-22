// Polled by the page until the background job has written its result.
const { jsonResp } = require("./lib");

exports.handler = async (event) => {
  const jobId = (event.queryStringParameters || {}).jobId;
  if (!jobId) return jsonResp(400, { error: "missing jobId" });
  try {
    // @netlify/blobs is ESM-only — load it via dynamic import() from CommonJS.
    const { getStore } = await import("@netlify/blobs");
    const store = getStore("catalyst-jobs");
    const data = await store.get(jobId, { type: "json" });
    if (!data) return jsonResp(200, { status: "pending" });
    return jsonResp(200, data);
  } catch (e) {
    return jsonResp(500, { error: String((e && e.message) || e) });
  }
};
