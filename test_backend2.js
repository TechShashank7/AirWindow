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
.then(res => Promise.all([res.status, res.text()]))
.then(([status, text]) => console.log('AWS Backend HTTP', status, ':', text))
.catch(err => console.error(err));
