import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { countUnreadNotifications, markNotificationsRead, NOTIFICATION_READ_LIMIT, readNotifications } from '../repositories/Notifications.service.js';
import { authenticate } from '../security/sessions.js';

const id = z.string().min(1).max(128);

/** Every route reads the identity from the session alone: there is no way to name another person's inbox. */
export function registerNotifications(app: FastifyInstance) {
  app.get('/api/me/notifications', async request => {
    z.strictObject({}).parse(request.query);
    const { identity } = await authenticate(request);
    // Names whose inbox this is: a browser tab can outlive the account its cookie now belongs to.
    return { identityId: identity.id, notifications: await readNotifications(identity.id) };
  });
  app.get('/api/me/notifications/unread', async request => {
    z.strictObject({}).parse(request.query);
    const { identity } = await authenticate(request);
    return { unread: await countUnreadNotifications(identity.id) };
  });
  app.post('/api/me/notifications/read', async request => {
    const { identity } = await authenticate(request);
    const { ids } = z.strictObject({ ids: z.array(id).min(1).max(NOTIFICATION_READ_LIMIT) }).parse(request.body);
    await markNotificationsRead(identity.id, ids);
    return { unread: await countUnreadNotifications(identity.id) };
  });
}
