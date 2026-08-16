require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const nodemailer = require("nodemailer");

const USER = process.env.EMAIL_USER;
const PASS = process.env.EMAIL_PASS;

console.log("EMAIL_USER:", USER || "(NOT SET)");
console.log("EMAIL_PASS length:", PASS ? PASS.length : "(NOT SET)");
console.log("EMAIL_PASS has spaces:", PASS ? /\s/.test(PASS) : "n/a");

async function tryConfig(label, config) {
  console.log(`\n========== ${label} ==========`);
  try {
    const t = nodemailer.createTransport({
      ...config,
      auth: { user: USER, pass: PASS },
      logger: true, debug: true,
      connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 20000,
    });
    await t.verify();
    console.log(`\nSUCCESS: ${label}`);
    return true;
  } catch (e) {
    console.log(`\nFAILED: ${label} - ${e.message}`);
    if (e.code) console.log("  code:", e.code);
    if (e.response) console.log("  response:", e.response);
    return false;
  }
}

(async () => {
  const a = await tryConfig("PORT 587 STARTTLS", { host: "smtp.gmail.com", port: 587, secure: false, requireTLS: true });
  const b = await tryConfig("PORT 465 TLS", { host: "smtp.gmail.com", port: 465, secure: true });
  console.log("\n========== SUMMARY ==========");
  console.log("587:", a ? "WORKS" : "failed");
  console.log("465:", b ? "WORKS" : "failed");
})();
