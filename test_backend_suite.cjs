const https = require('https');

const API_URL = "https://ifx0gvr7u0.execute-api.ap-southeast-2.amazonaws.com/evaluate";

function makeRequest(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log("1. Valid Input");
  const valid = await makeRequest({
    latitude: 28.6139, longitude: 77.2090, timezone: "Asia/Kolkata",
    durationMinutes: 60, preferredStart: "2026-10-10T10:00", preferredEnd: "2026-10-10T18:00", currentTime: "2026-10-10T08:00"
  });
  console.log(`Status: ${valid.status}`);

  console.log("\n2. Missing Params");
  const missing = await makeRequest({});
  console.log(`Status: ${missing.status}`);

  console.log("\n3. Invalid Duration");
  const invalidDur = await makeRequest({
    latitude: 28.6139, longitude: 77.2090, timezone: "Asia/Kolkata",
    durationMinutes: 45, preferredStart: "2026-10-10T10:00", preferredEnd: "2026-10-10T18:00", currentTime: "2026-10-10T08:00"
  });
  console.log(`Status: ${invalidDur.status}`);
  console.log(`Body: ${invalidDur.body.substring(0, 100)}...`);

  console.log("\n4. End before Start");
  const reversedDates = await makeRequest({
    latitude: 28.6139, longitude: 77.2090, timezone: "Asia/Kolkata",
    durationMinutes: 60, preferredStart: "2026-10-10T18:00", preferredEnd: "2026-10-10T10:00", currentTime: "2026-10-10T08:00"
  });
  console.log(`Status: ${reversedDates.status}`);
  console.log(`Body: ${reversedDates.body.substring(0, 100)}...`);

  console.log("\n5. Out of bounds Lat/Lon");
  const badLat = await makeRequest({
    latitude: 100, longitude: 77.2090, timezone: "Asia/Kolkata",
    durationMinutes: 60, preferredStart: "2026-10-10T10:00", preferredEnd: "2026-10-10T18:00", currentTime: "2026-10-10T08:00"
  });
  console.log(`Status: ${badLat.status}`);
  console.log(`Body: ${badLat.body.substring(0, 100)}...`);
}
runTests();
