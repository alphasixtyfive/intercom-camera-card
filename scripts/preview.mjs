import http from 'node:http';
import { readFile } from 'node:fs/promises';

const files = {
    '/': ['test/preview.html', 'text/html'],
    '/intercom-camera-card.js': ['intercom-camera-card.js', 'text/javascript'],
    '/webrtc/video-rtc.js': ['test/fixtures/video-rtc.js', 'text/javascript'],
};
http.createServer(async (request, response) => {
    const file = files[new URL(request.url, 'http://localhost').pathname];
    if (!file) {
        response.writeHead(404).end();
        return;
    }
    try {
        response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
        response.end(await readFile(file[0]));
    } catch {
        response.writeHead(500).end('Build the card before starting the preview.');
    }
}).listen(8765, '127.0.0.1', () => console.log('Card preview: http://127.0.0.1:8765'));
