import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = join(__dirname, "../.env.local");
const TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_ID = process.env.VERCEL_PROJECT_ID;
const TEAM_ID = process.env.VERCEL_TEAM_ID;

if (!TOKEN || !PROJECT_ID || !TEAM_ID) {
  console.error("Missing VERCEL_TOKEN, VERCEL_PROJECT_ID or VERCEL_TEAM_ID");
  process.exit(1);
}

const lines = readFileSync(envFile, "utf8").split("\n");
const envVars = [];
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const idx = trimmed.indexOf("=");
  if (idx < 0) continue;
  const key = trimmed.slice(0, idx).trim();
  const value = trimmed.slice(idx + 1).trim();
  if (key) envVars.push({ key, value });
}

console.log(`Found ${envVars.length} variables to push...`);

for (const { key, value } of envVars) {
  const res = await fetch(
    `https://api.vercel.com/v10/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key,
        value,
        type: "encrypted",
        target: ["production", "preview"],
      }),
    }
  );
  const data = await res.json();
  if (data.key) {
    console.log(`  ✓ ${key}`);
  } else if (data.error?.code === "ENV_ALREADY_EXISTS") {
    console.log(`  ~ ${key} (already exists, skipping)`);
  } else {
    console.log(`  ✗ ${key}: ${data.error?.message ?? JSON.stringify(data)}`);
  }
}

console.log("\nDone. Now deploying to production...");
