const req = {
    latitude: 28.6139,
    longitude: 77.2090,
    timezone: "Asia/Kolkata",
    durationMinutes: 60,
    preferredStart: "2026-10-10T10:00",
    preferredEnd: "2026-10-10T18:00",
    currentTime: "2026-10-10T08:00"
};

fetch('https://ifx0gvr7u0.execute-api.ap-southeast-2.amazonaws.com/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req)
})
.then(res => {
    console.log("Status:", res.status);
    console.log("Headers:", Array.from(res.headers.entries()));
    return res.text();
})
.then(text => console.log('Body:', text))
.catch(err => console.error(err));
