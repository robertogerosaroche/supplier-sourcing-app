import express from "express";
import fetch from "node-fetch"; // will be installed via npm

const app = express();
app.use(express.json());

const SERP_API_KEY = process.env.SERPAPI_KEY; // set via env var on Render

function buildQuery(requirements, country, certifications) {
  let base = (requirements || "").trim();
  if (!base) base = "industrial supplier";

  if (certifications) {
    base += " " + certifications;
  }

  const extraKeywords = ["supplier", "manufacturer", "vendor", "B2B"];
  let query = `${base} (${extraKeywords.join(" OR ")})`;
  if (country) query += ` in ${country}`;

  return query;
}

function mapResultToSupplier(item, country, requirements) {
  const url = item.link || item.url || "";
  let displayLink = "unknown";
  try {
    if (url) displayLink = new URL(url).hostname;
  } catch (_) {}

  const title = item.title || displayLink;
  const snippet = item.snippet || item.description || "";

  const lowerSnippet = snippet.toLowerCase();
  const lowerReq = (requirements || "").toLowerCase();

  // ---------- Tags (same idea as before) ----------
  const tags = [];
  if (lowerSnippet.includes("iso")) tags.push("ISO / quality");
  if (lowerSnippet.includes("medical") || lowerSnippet.includes("pharma"))
    tags.push("Life sciences");
  if (lowerSnippet.includes("plastic")) tags.push("Plastics");
  if (lowerSnippet.includes("contract manufacturing"))
    tags.push("Contract manufacturing");
  if (lowerReq.includes("prototype") || lowerReq.includes("prototyping"))
    tags.push("Prototyping");
  tags.push("Web result");

  // ---------- Approximate generic specs ----------

  // company size & employees (very rough guess based on keywords)
  let sizeCategory = "Unknown";
  let employees = "Unknown (check company website / LinkedIn)";

  if (lowerSnippet.includes("employees")) {
    employees = "Employees mentioned in snippet – confirm on website";
  }
  if (
    lowerSnippet.includes("small company") ||
    lowerSnippet.includes("sme") ||
    lowerSnippet.includes("family-owned") ||
    lowerSnippet.includes("family owned")
  ) {
    sizeCategory = "Small / SME (heuristic from snippet)";
  } else if (
    lowerSnippet.includes("multinational") ||
    lowerSnippet.includes("global leader") ||
    lowerSnippet.includes("worldwide") ||
    lowerSnippet.includes("thousands of employees")
  ) {
    sizeCategory = "Large / multinational (heuristic from snippet)";
  } else if (sizeCategory === "Unknown") {
    sizeCategory = "Not stated – likely small/medium (verify manually)";
  }

  // turnover note
  let turnover = "Not stated – check company financials / About page.";
  if (
    lowerSnippet.includes("million") ||
    lowerSnippet.includes("billion") ||
    lowerSnippet.includes("turnover") ||
    lowerSnippet.includes("revenue")
  ) {
    turnover = "Turnover / revenue mentioned in snippet – check original page for figures.";
  }

  // location note – best effort from snippet or title
  let location = country || "Not specified";
  let locationDetail = "Location not clearly stated in search snippet.";

  const locationPatterns = [
    /based in ([A-Za-z\s-]+)/i,
    /headquartered in ([A-Za-z\s-]+)/i,
    /located in ([A-Za-z\s-]+)/i
  ];

  for (const pattern of locationPatterns) {
    const m = snippet.match(pattern) || title.match(pattern);
    if (m && m[1]) {
      location = m[1].trim() + (country ? `, ${country}` : "");
      locationDetail = `Appears to be located in ${m[1].trim()} (from snippet/title).`;
      break;
    }
  }

  // ---------- Match info for the specific request ----------

  // Take some longer keywords from the requirement text (4+ chars)
  const requirementKeywords = (requirements || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);

  const uniqueKeywords = [...new Set(requirementKeywords)].slice(0, 8); // max 8

  const matchedKeywords = uniqueKeywords.filter((k) => lowerSnippet.includes(k));
  const matchScore =
    uniqueKeywords.length > 0
      ? Math.round((matchedKeywords.length / uniqueKeywords.length) * 100)
      : 0;

  let matchSummary;
  if (!uniqueKeywords.length) {
    matchSummary = "No specific keywords provided – generic supplier match.";
  } else if (matchScore === 0) {
    matchSummary =
      "Snippet does not clearly mention your key terms – review manually for fit.";
  } else {
    matchSummary = `Matches approx. ${matchScore}% of your key terms: ${matchedKeywords.join(
      ", "
    )}.`;
  }

  return {
    name: title,
    url,
    displayLink,
    countryHint: country || "Not specified",
    description: snippet,
    tags,

    // new generic spec fields
    sizeCategory,
    employees,
    turnover,
    location,
    locationDetail,

    // new request-specific fields
    matchScore,
    matchSummary
  };
}


app.post("/api/search-suppliers", async (req, res) => {
  try {
    const { requirements, country, certifications, maxResults } = req.body || {};
    const query = buildQuery(requirements, country, certifications);
    const num = maxResults && maxResults > 0 ? Math.min(maxResults, 20) : 10;

    if (!SERP_API_KEY) {
      return res.status(500).json({ error: "SerpAPI key not configured on server." });
    }

    const params = new URLSearchParams({
      engine: "google",
      q: query,
      api_key: SERP_API_KEY,
      num: String(num),
    });

    const url = `https://serpapi.com/search.json?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error("SerpAPI HTTP error:", response.status);
      return res.status(502).json({ error: `SerpAPI HTTP error ${response.status}` });
    }

    const data = await response.json();
    const results = data.organic_results || [];
    const suppliers = results
      .filter((r) => r.link)
      .slice(0, num)
      .map((item) => mapResultToSupplier(item, country, requirements));

    res.json(suppliers);
  } catch (err) {
    console.error("Backend error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// serve static frontend
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
