require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const SSH_HOST = process.env.MAC_STUDIO_HOST || "10.0.0.164";
const SSH_USER = process.env.MAC_STUDIO_USER || "postmams";
const IBM_MOUNT = process.env.IBM_MOUNT || "/Volumes/snibmprod";
const COMP_MOUNT = process.env.COMP_MOUNT || "/Volumes/sncomprod";
const MAMS_API_URL = (process.env.MAMS_API_URL || "http://localhost:5179").replace(/\/+$/, "");

// df -k reports 1024-byte (KiB) blocks. We convert to decimal TB (1e12 bytes)
// to match how storage is normally advertised/reported.
const KIB_TO_TB = 1024 / 1e12;

async function fetchDfUsage() {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      "ssh",
      [
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
        `${SSH_USER}@${SSH_HOST}`,
        `df -k ${IBM_MOUNT} ${COMP_MOUNT}`,
      ]
    ));
  } catch (err) {
    throw new Error(`SSH to ${SSH_USER}@${SSH_HOST} failed: ${err.message}`);
  }

  const lines = stdout.trim().split("\n").slice(1); // drop header row
  const usedKiB = {};
  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    // Filesystem Size Used Avail Capacity iused ifree %iused Mounted-on
    const used = Number(cols[2]);
    const mount = cols[cols.length - 1];
    if (!Number.isFinite(used)) continue;
    if (mount === IBM_MOUNT) usedKiB.ibm = used;
    if (mount === COMP_MOUNT) usedKiB.comp = used;
  }

  if (usedKiB.ibm === undefined || usedKiB.comp === undefined) {
    throw new Error(`Could not parse df output for ${IBM_MOUNT} / ${COMP_MOUNT}:\n${stdout}`);
  }

  return {
    ibmUsed: usedKiB.ibm * KIB_TO_TB,
    dellUsed: usedKiB.comp * KIB_TO_TB,
  };
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
  const { ibmUsed, dellUsed } = await fetchDfUsage();

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
