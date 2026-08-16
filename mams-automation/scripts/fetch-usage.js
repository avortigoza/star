require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const MSUM_URL = (process.env.MSUM_URL || "http://172.30.10.222:8083").replace(/\/+$/, "");
const MSUM_USER = process.env.MSUM_USER;
const MSUM_PASS = process.env.MSUM_PASS;
const MAMS_API_URL = (process.env.MAMS_API_URL || "http://localhost:5179").replace(/\/+$/, "");

function extractCookies(res) {
  let raw = [];
  if (typeof res.headers.getSetCookie === "function") {
    raw = res.headers.getSetCookie();
  } else {
    const combined = res.headers.get("set-cookie");
    if (combined) raw = [combined];
  }
  return raw.map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
}

async function login() {
  const res = await fetch(`${MSUM_URL}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: MSUM_USER, password: MSUM_PASS, remember_me: false }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Login to ${MSUM_URL} failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const cookie = extractCookies(res);
  if (!cookie) throw new Error("Login succeeded but no session cookie returned.");
  return cookie;
}

async function fetchSummary(cookie) {
  const res = await fetch(`${MSUM_URL}/api/storage-summary`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`GET /api/storage-summary failed: HTTP ${res.status}`);
  return res.json();
}

async function pushUsage(ibm, comp) {
  const res = await fetch(`${MAMS_API_URL}/api/usage`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ibm, comp }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PUT /api/usage failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function main() {
  if (!MSUM_USER || !MSUM_PASS) {
    throw new Error("MSUM_USER / MSUM_PASS are not set in .env");
  }

  const cookie = await login();
  const summary = await fetchSummary(cookie);

  const ibmUsed = summary?.ibm?.used;
  const dellUsed = summary?.dell?.used;

  if (typeof ibmUsed !== "number" || typeof dellUsed !== "number") {
    throw new Error(`Unexpected response shape: ibm.used=${JSON.stringify(ibmUsed)} dell.used=${JSON.stringify(dellUsed)}`);
  }

  const ibm = Math.round(ibmUsed);
  const comp = Math.round(dellUsed);

  if (ibm < 0 || ibm > 660 || comp < 0 || comp > 616) {
    throw new Error(`Refusing to push out-of-range values (IBM=${ibm} of 660, COMP=${comp} of 616).`);
  }

  await pushUsage(ibm, comp);
  console.log(`[${new Date().toISOString()}] Pushed usage - IBM: ${ibm} TB (from ${ibmUsed}), COMP: ${comp} TB (from ${dellUsed})`);
}

main().catch((err) => {
  console.error("fetch-usage.js failed:", err.message);
  process.exit(1);
});
