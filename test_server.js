const { handler } = require('./lambda/handler.js');
const http = require('http');

http.createServer(async (req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
        try {
            const event = {
                httpMethod: req.method,
                body: body || '{}'
            };
            const result = await handler(event);
            res.writeHead(result.statusCode, result.headers);
            res.end(result.body);
        } catch (err) {
            console.error("UNHANDLED LAMBDA ERROR:", err);
            res.writeHead(500);
            res.end("Internal Server Error");
        }
    });
}).listen(3000, () => console.log('Listening on 3000'));
