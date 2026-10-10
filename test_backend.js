import fs from 'fs';

async function testBackend() {
    const req = {
        latitude: 28.6139,
        longitude: 77.2090,
        timezone: "Asia/Kolkata",
        durationMinutes: 60,
        preferredStart: "2026-10-10T10:00",
        preferredEnd: "2026-10-10T18:00",
        currentTime: "2026-10-10T08:00"
    };

    console.log("Testing Backend API...");
    const res = await fetch('https://ifx0gvr7u0.execute-api.ap-southeast-2.amazonaws.com/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req)
    });
    const data = await res.json();
    console.log("Backend Response retrievedAt:", data.retrievedAt);
    
    // Write out the result so we can use it to test frontend logic
    fs.writeFileSync('backend_res.json', JSON.stringify(data, null, 2));
    console.log("Backend response saved to backend_res.json");
    
    return { req, data };
}

testBackend().catch(console.error);
