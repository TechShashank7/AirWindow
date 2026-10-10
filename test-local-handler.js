const { handler } = require('./lambda/handler.js');
handler({
  body: {
    latitude: 28.6139,
    longitude: 77.2090,
    timezone: "Asia/Kolkata",
    durationMinutes: 60,
    preferredStart: "2026-10-10T10:00",
    preferredEnd: "2026-10-10T18:00",
    currentTime: "2026-10-10T08:00"
  }
}).then(res => console.log(res)).catch(err => console.error(err));
