import * as admin from './admin.js';
import * as auth from './auth.js';
import * as bookings from './bookings.js';
import * as cms from './cms.js';
import * as drivers from './drivers.js';
import * as misc from './misc.js';
import * as tours from './tours.js';
import * as uploads from './uploads.js';

const table = [];

function add(method, pattern, handler) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((part) => {
      if (!part) return '';
      if (part.startsWith(':')) {
        keys.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  table.push({ method, regex: new RegExp(`^${source}/?$`), keys, handler });
}

function route(method, pattern, handler) {
  add(method, pattern, handler);
}

// Public + session
route('GET', '/health', misc.health);
route('GET', '/public/stats', misc.publicStats);
route('GET', '/public/fares', cms.publicFares);
route('GET', '/public/events', cms.publicEvents);
route('GET', '/public/routes', cms.publicRoutes);
route('GET', '/public/site', cms.publicSite);
route('GET', '/route', misc.getRoute);
route('POST', '/auth/register', auth.register);
route('POST', '/auth/login', auth.login);
route('POST', '/auth/logout', auth.logout);
route('GET', '/auth/me', auth.me);
route('PATCH', '/profile', auth.updateProfile);
route('POST', '/profile/password', auth.changePassword);
route('GET', '/notifications', misc.notifications);
route('POST', '/notifications/read', misc.markNotificationsRead);
route('POST', '/reports', misc.createReport);
route('POST', '/newsletter/subscribe', misc.subscribeNewsletter);
route('POST', '/upload', uploads.uploadMedia);
route('GET', '/uploads/:filename', uploads.getUpload);

// Drivers
route('GET', '/drivers/nearby', drivers.nearby);
route('GET', '/driver/me', drivers.driverMe);
route('PATCH', '/driver/status', drivers.setStatus);
route('PATCH', '/driver/profile', drivers.updateProfile);
route('GET', '/driver/requests', drivers.requests);
route('POST', '/driver/verify', drivers.verify);

// Rides
route('POST', '/estimate', bookings.estimateFare);
route('GET', '/bookings', bookings.list);
route('POST', '/bookings', bookings.create);
route('GET', '/bookings/:id', bookings.detail);
route('POST', '/bookings/:id/accept', bookings.accept);
route('PATCH', '/bookings/:id/status', bookings.updateStatus);
route('POST', '/bookings/:id/cancel', bookings.cancel);
route('POST', '/bookings/:id/rate', bookings.rate);
route('GET', '/bookings/:id/qr', bookings.qr);
route('GET', '/bookings/:id/messages', bookings.messagesGet);
route('POST', '/bookings/:id/messages', bookings.messagesPost);

// Tours
route('GET', '/tours', tours.list);
route('POST', '/tours', tours.create);
route('GET', '/tours/:id', tours.detail);
route('POST', '/tours/:id/join', tours.join);
route('POST', '/tours/:id/leave', tours.leave);
route('POST', '/tours/:id/cancel', tours.cancel);
route('GET', '/tours/:id/messages', tours.messagesGet);
route('POST', '/tours/:id/messages', tours.messagesPost);

// Admin CRM
route('GET', '/admin/overview', admin.overview);
route('GET', '/admin/drivers', admin.drivers);
route('PATCH', '/admin/drivers/:id', admin.updateDriver);
route('DELETE', '/admin/drivers/:id', admin.deleteDriver);
route('GET', '/admin/users', admin.users);
route('POST', '/admin/users', admin.createUser);
route('PATCH', '/admin/users/:id', admin.updateUser);
route('DELETE', '/admin/users/:id', admin.deleteUser);
route('GET', '/admin/bookings', admin.bookings);
route('PATCH', '/admin/bookings/:id', admin.updateBooking);
route('DELETE', '/admin/bookings/:id', admin.deleteBooking);
route('GET', '/admin/tours', admin.tours);
route('POST', '/admin/tours', cms.createTourAdmin);
route('PATCH', '/admin/tours/:id', cms.updateTourAdmin);
route('DELETE', '/admin/tours/:id', cms.deleteTourAdmin);
route('GET', '/admin/events', cms.events);
route('POST', '/admin/events', cms.createEvent);
route('PATCH', '/admin/events/:id', cms.updateEvent);
route('DELETE', '/admin/events/:id', cms.deleteEvent);
route('GET', '/admin/routes', cms.routes);
route('POST', '/admin/routes', cms.createRoute);
route('PATCH', '/admin/routes/:id', cms.updateRoute);
route('DELETE', '/admin/routes/:id', cms.deleteRoute);
route('GET', '/admin/fares', cms.fares);
route('PATCH', '/admin/fares/:key', cms.updateFare);
route('GET', '/admin/site', cms.getSite);
route('POST', '/admin/site', cms.updateSite);
route('GET', '/admin/reports', admin.reports);
route('PATCH', '/admin/reports/:id', admin.resolveReport);
route('DELETE', '/admin/reports/:id', admin.deleteReport);
route('GET', '/admin/audit', admin.auditLog);
route('GET', '/admin/email/settings', admin.emailSettings);
route('POST', '/admin/email/settings', admin.setEmailSettings);
route('POST', '/admin/email/test', admin.testEmailSend);
route('DELETE', '/admin/email/outbox/:id', admin.deleteOutboxItem);
route('GET', '/admin/subscribers', admin.subscribersList);
route('DELETE', '/admin/subscribers/:id', admin.deleteSubscriber);

export function match(method, pathname) {
  const wanted = method === 'HEAD' ? 'GET' : method;
  for (const entry of table) {
    if (entry.method !== wanted) continue;
    const found = entry.regex.exec(pathname);
    if (!found) continue;
    const params = {};
    entry.keys.forEach((key, index) => {
      const raw = decodeURIComponent(found[index + 1] || '');
      params[key] = /^\d+$/.test(raw) ? Number(raw) : raw;
    });
    return { handler: entry.handler, params };
  }
  return null;
}

export function allowedMethods(pathname) {
  const methods = new Set();
  for (const entry of table) {
    if (entry.regex.test(pathname)) methods.add(entry.method);
  }
  return [...methods];
}
