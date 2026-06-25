/* ============================================================
   Tracer configuration
   ------------------------------------------------------------
   Edit this one file to switch from the built-in estimate model
   to a live retail price API. See README for the expected shape.
   ============================================================ */

export const CONFIG = {
  // Base URL of a price API that returns historical prices.
  // Leave null to use the built-in deterministic estimate model.
  //
  //   apiBase: "https://your-price-api.example.com",
  //
  // When set, Tracer calls:  `${apiBase}/history?q=<query>`
  // and expects JSON: { series:[{ t:<ms>, price:<number> }, ...],
  //                     category?:string, currency?:string }
  apiBase: null,

  // Optional bearer token sent as `Authorization: Bearer <token>`.
  apiKey: null,

  // ISO currency code used for formatting (display only).
  currency: "USD",

  // Retailers shown in the price comparison + their search endpoints.
  // Buy links are real searches, so they work regardless of data source.
  retailers: [
    { name: "Amazon",   color: "#ff9900", search: "https://www.amazon.com/s?k=" },
    { name: "Walmart",  color: "#0071dc", search: "https://www.walmart.com/search?q=" },
    { name: "Best Buy", color: "#0046be", search: "https://www.bestbuy.com/site/searchpage.jsp?st=" },
    { name: "Target",   color: "#cc0000", search: "https://www.target.com/s?searchTerm=" },
    { name: "eBay",     color: "#86b817", search: "https://www.ebay.com/sch/i.html?_nkw=" },
    { name: "Newegg",   color: "#f7a01d", search: "https://www.newegg.com/p/pl?d=" },
  ],
};
