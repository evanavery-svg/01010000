/* Mock of the Tracer price proxy for local testing.
   Returns normalized current-price JSON with CORS, deterministic per query.
   Usage: node scripts/mock-proxy.mjs [port]
   Then:  http://localhost:8137/index.html?api=http://localhost:8787 */
import { createServer } from "node:http";

const port = Number(process.argv[2]) || 8787;

function hash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const STORES = ["Amazon", "Walmart", "Best Buy", "Target", "eBay"];

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://localhost:${port}`);
  const q = url.searchParams.get("q") || "";
  const h = hash(q.toLowerCase());
  const current = Math.round((40 + (h % 90000) / 100) * 100) / 100; // $40–$940
  const body = JSON.stringify({
    current,
    currency: "USD",
    category: "Electronics",
    retailer: STORES[h % STORES.length],
  });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(body);
}).listen(port, () => console.log(`mock proxy on http://localhost:${port}`));
