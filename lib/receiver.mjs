import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { buildMessage } from '../scripts/notify.mjs';

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        chunks.length = 0;
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function createReceiver({ secret, organization, store }) {
  if (!secret || secret.length < 32) throw new Error('GITHUB_WEBHOOK_SECRET must contain at least 32 characters.');
  if (!/^[a-z\d-]+$/i.test(organization || '')) throw new Error('Set GITHUB_ORGANIZATION to your GitHub organization login.');
  return createServer(async (req, res) => {
    const reply = (status, text) => { res.writeHead(status, { 'Content-Type': 'text/plain' }); res.end(text); };
    if (req.url === '/healthz' && req.method === 'GET') return reply(200, 'ok');
    if (req.url !== '/github/webhook') return reply(404, 'Not found');
    if (req.method !== 'POST') return reply(405, 'POST required');
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return reply(415, 'JSON required');
    try {
      const raw = await readBody(req);
      const signature = req.headers['x-hub-signature-256'];
      const expected = createHmac('sha256', secret).update(raw).digest();
      if (typeof signature !== 'string' || !/^sha256=[a-f\d]{64}$/i.test(signature)
          || !timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'))) return reply(401, 'Invalid signature');
      let payload;
      try { payload = JSON.parse(raw.toString('utf8')); } catch { return reply(400, 'Invalid JSON'); }
      if (!payload || typeof payload !== 'object') return reply(400, 'Invalid payload');
      const event = req.headers['x-github-event'];
      if (event === 'ping') return reply(200, 'pong');
      if (!['issues', 'pull_request'].includes(event)) return reply(204, '');
      if (payload.repository?.owner?.login?.toLowerCase() !== organization.toLowerCase()) return reply(403, 'Organization not allowed');
      const id = req.headers['x-github-delivery'];
      if (typeof id !== 'string' || !/^[a-z\d-]{1,100}$/i.test(id)) return reply(400, 'Invalid delivery ID');
      let message;
      try { message = buildMessage(event, payload); } catch { return reply(400, 'Invalid event payload'); }
      if (!message) return reply(204, '');
      const queued = store.enqueue(id, message);
      return reply(202, queued ? 'Queued' : 'Already received');
    } catch (error) {
      if (error.status === 413) return reply(413, 'Payload exceeds 2 MiB');
      console.error('Webhook request failed. Check persistent storage.');
      return reply(500, 'Unable to accept delivery');
    }
  });
}
