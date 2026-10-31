import { hashPassword } from './security.js';
import { addisTimeIn, daysAgo, estimate, nowIso, roadDistanceKm } from './util.js';

const PASSWORD = {
  admin: 'Admin123!',
  rider: 'Rider123!',
  guide: 'Guide123!',
  driver: 'Driver123!',
};

function addUser(db, { name, email, phone, password, role, bio, verified, color }) {
  const { lastInsertRowid } = db.run(
    `INSERT INTO users (name, email, phone, password_hash, role, bio, languages, avatar_color, is_verified, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'English, Amharic', ?, ?, 'active', ?)`,
    [name, email, phone, hashPassword(password), role, bio, color, verified ? 1 : 0, daysAgo(30)],
  );
  return lastInsertRowid;
}

function addDriver(db, d) {
  const { lastInsertRowid } = db.run(
    `INSERT INTO drivers (user_id, vehicle_class, make_model, plate, color, license_no, status, is_online,
        lat, lng, rating, rating_count, trips, created_at, approved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.userId,
      d.class,
      d.model,
      d.plate,
      d.color,
      d.license,
      d.status,
      d.online ? 1 : 0,
      d.lat,
      d.lng,
      d.rating,
      d.ratingCount,
      d.trips,
      daysAgo(20),
      d.status === 'approved' ? daysAgo(15) : null,
    ],
  );
  return lastInsertRowid;
}

function addBooking(db, b) {
  const km = roadDistanceKm(b.pLat, b.pLng, b.dLat, b.dLng);
  const priced = estimate(b.class, km) || { fare: 100, durationMin: 10 };
  const { lastInsertRowid } = db.run(
    `INSERT INTO bookings (code, customer_id, driver_id, pickup, pickup_lat, pickup_lng, dropoff,
        dropoff_lat, dropoff_lng, vehicle_class, distance_km, duration_min, fare, status, scheduled_for,
        notes, rating, review, created_at, accepted_at, started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      b.code,
      b.customerId,
      b.driverId,
      b.pickup,
      b.pLat,
      b.pLng,
      b.dropoff,
      b.dLat,
      b.dLng,
      b.class,
      Math.round(km * 10) / 10,
      priced.durationMin,
      priced.fare,
      b.status,
      b.scheduledFor ?? null,
      b.notes ?? '',
      b.rating ?? null,
      b.review ?? '',
      b.createdAt,
      b.acceptedAt ?? null,
      b.acceptedAt ?? null,
      b.completedAt ?? null,
    ],
  );
  return lastInsertRowid;
}

function addTour(db, t) {
  const { lastInsertRowid } = db.run(
    `INSERT INTO tours (host_id, title, description, meeting_point, lat, lng, starts_at, duration_min,
        capacity, price, theme, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', ?)`,
    [t.hostId, t.title, t.description, t.meeting, t.lat, t.lng, t.startsAt, t.duration, t.capacity, t.price, t.theme, daysAgo(10)],
  );
  return lastInsertRowid;
}

/** Idempotent: only runs on an empty database. */
export function seed(db) {
  const existing = db.get('SELECT COUNT(*) AS n FROM users');
  if (Number(existing.n) > 0) return { seeded: false };

  const users = {};

  db.tx(() => {
    users.admin = addUser(db, {
      name: 'Selamawit Bekele',
      email: 'admin@addisgo.et',
      phone: '+251 911 000 001',
      password: PASSWORD.admin,
      role: 'admin',
      bio: 'Operations lead at AddisGo. Keeping every trip safe and on time.',
      verified: true,
      color: '#0d3b2e',
    });
    users.meron = addUser(db, {
      name: 'Meron Tadesse',
      email: 'meron@example.com',
      phone: '+251 911 234 567',
      password: PASSWORD.rider,
      role: 'customer',
      bio: 'Product designer. Bole local, always chasing the best macchiato.',
      verified: true,
      color: '#e86a4a',
    });
    users.abel = addUser(db, {
      name: 'Abel Tesfaye',
      email: 'abel@example.com',
      phone: '+251 922 555 010',
      password: PASSWORD.rider,
      role: 'customer',
      bio: 'Coffee trader who moves between Kazanchis and Bole all week.',
      verified: true,
      color: '#4a7c9e',
    });
    users.liya = addUser(db, {
      name: 'Liya Haile',
      email: 'liya@example.com',
      phone: '+251 933 555 011',
      password: PASSWORD.rider,
      role: 'customer',
      bio: 'Architecture student, weekend tour regular.',
      verified: false,
      color: '#b06ab3',
    });
    users.jake = addUser(db, {
      name: 'Jake Miller',
      email: 'jake@example.com',
      phone: '+1 202 555 0142',
      password: PASSWORD.rider,
      role: 'customer',
      bio: 'Visiting Addis for a month. Here for the food, history and hikes.',
      verified: false,
      color: '#d19a3e',
    });
    users.selam = addUser(db, {
      name: 'Selam Girma',
      email: 'selam@example.com',
      phone: '+251 944 555 012',
      password: PASSWORD.guide,
      role: 'customer',
      bio: 'Born-and-raised Addis guide. Entoto sunsets, hidden galleries and strong coffee.',
      verified: true,
      color: '#2f7d62',
    });
    users.nahom = addUser(db, {
      name: 'Nahom Assefa',
      email: 'nahom@example.com',
      phone: '+251 955 555 013',
      password: PASSWORD.guide,
      role: 'customer',
      bio: 'Food historian and Merkato regular. I explain the spices, you taste them.',
      verified: true,
      color: '#9c5b3b',
    });
    users.dawit = addUser(db, {
      name: 'Dawit Mekonnen',
      email: 'dawit@example.com',
      phone: '+251 911 555 021',
      password: PASSWORD.driver,
      role: 'driver',
      bio: 'Quiet electric rides across Bole and the airport road.',
      verified: true,
      color: '#145c45',
    });
    users.hanna = addUser(db, {
      name: 'Hanna Getachew',
      email: 'hanna@example.com',
      phone: '+251 912 555 022',
      password: PASSWORD.driver,
      role: 'driver',
      bio: 'Comfort-class driver. Ask me where to find the best shiro.',
      verified: true,
      color: '#c47c2b',
    });
    users.yonas = addUser(db, {
      name: 'Yonas Alemu',
      email: 'yonas@example.com',
      phone: '+251 913 555 023',
      password: PASSWORD.driver,
      role: 'driver',
      bio: 'Piassa local, EV driver, five-star airport runs.',
      verified: true,
      color: '#3b6ea5',
    });
    users.marta = addUser(db, {
      name: 'Marta Haile',
      email: 'marta@example.com',
      phone: '+251 914 555 024',
      password: PASSWORD.driver,
      role: 'driver',
      bio: 'Megenagna to CMC comfort rides, weekday mornings.',
      verified: true,
      color: '#a8578a',
    });
    users.bereket = addUser(db, {
      name: 'Bereket Solomon',
      email: 'bereket@example.com',
      phone: '+251 915 555 025',
      password: PASSWORD.driver,
      role: 'driver',
      bio: 'Tour van driver for groups and airport luggage runs.',
      verified: true,
      color: '#6b7f3a',
    });
    users.lidya = addUser(db, {
      name: 'Lidya Tesfaye',
      email: 'lidya@example.com',
      phone: '+251 916 555 026',
      password: PASSWORD.driver,
      role: 'driver',
      bio: 'Electric E2 driver around Entoto and Sahlitemariam.',
      verified: true,
      color: '#c4523e',
    });
    users.rahel = addUser(db, {
      name: 'Rahel Worku',
      email: 'rahel@example.com',
      phone: '+251 917 555 027',
      password: PASSWORD.driver,
      role: 'driver',
      bio: 'Comfort driver covering Sarbet, Old Airport and CMC.',
      verified: true,
      color: '#4f8b85',
    });
    users.tesfaye = addUser(db, {
      name: 'Tesfaye Bekele',
      email: 'tesfaye@example.com',
      phone: '+251 918 555 028',
      password: PASSWORD.driver,
      role: 'driver',
      bio: 'Group van driver, available on request for full-day tours.',
      verified: true,
      color: '#8a6d3b',
    });
    users.samuel = addUser(db, {
      name: 'Samuel Girma',
      email: 'samuel@example.com',
      phone: '+251 919 555 029',
      password: PASSWORD.driver,
      role: 'driver',
      bio: 'New to AddisGo. Electric E2, Bole and Megenagna.',
      verified: false,
      color: '#5c6b8a',
    });

    const drivers = {};
    drivers.dawit = addDriver(db, { userId: users.dawit, class: 'e2', model: 'BYD E2', plate: 'AA 2 12345', color: 'Pearl white', license: 'DL-AA-88421', status: 'approved', online: true, lat: 8.995, lng: 38.787, rating: 4.9, ratingCount: 128, trips: 342 });
    drivers.hanna = addDriver(db, { userId: users.hanna, class: 'comfort', model: 'Toyota Corolla', plate: 'AA 2 44190', color: 'Silver', license: 'DL-AA-77120', status: 'approved', online: true, lat: 9.014, lng: 38.762, rating: 4.8, ratingCount: 96, trips: 221 });
    drivers.yonas = addDriver(db, { userId: users.yonas, class: 'e2', model: 'BYD E2', plate: 'AA 3 90211', color: 'Ocean blue', license: 'DL-AA-65402', status: 'approved', online: true, lat: 9.034, lng: 38.75, rating: 4.7, ratingCount: 74, trips: 180 });
    drivers.marta = addDriver(db, { userId: users.marta, class: 'comfort', model: 'Suzuki Dzire', plate: 'AA 2 55781', color: 'White', license: 'DL-AA-91003', status: 'approved', online: true, lat: 9.02, lng: 38.801, rating: 4.9, ratingCount: 61, trips: 148 });
    drivers.bereket = addDriver(db, { userId: users.bereket, class: 'van', model: 'Toyota HiAce', plate: 'AA 1 33007', color: 'White', license: 'DL-AA-33219', status: 'approved', online: true, lat: 9.0, lng: 38.735, rating: 4.6, ratingCount: 39, trips: 87 });
    drivers.lidya = addDriver(db, { userId: users.lidya, class: 'e2', model: 'BYD E2', plate: 'AA 3 78112', color: 'Crimson', license: 'DL-AA-44321', status: 'approved', online: true, lat: 9.06, lng: 38.76, rating: 5.0, ratingCount: 21, trips: 46 });
    drivers.rahel = addDriver(db, { userId: users.rahel, class: 'comfort', model: 'Toyota Yaris', plate: 'AA 2 66402', color: 'Graphite', license: 'DL-AA-55012', status: 'approved', online: true, lat: 9.019, lng: 38.827, rating: 4.8, ratingCount: 33, trips: 72 });
    drivers.tesfaye = addDriver(db, { userId: users.tesfaye, class: 'van', model: 'Toyota HiAce', plate: 'AA 1 11882', color: 'Silver', license: 'DL-AA-22118', status: 'approved', online: false, lat: 9.036, lng: 38.84, rating: 4.5, ratingCount: 54, trips: 110 });
    drivers.samuel = addDriver(db, { userId: users.samuel, class: 'e2', model: 'BYD E2', plate: 'AA 4 00921', color: 'Midnight black', license: 'DL-AA-99410', status: 'pending', online: false, lat: 9.05, lng: 38.79, rating: 5.0, ratingCount: 0, trips: 0 });

    // Completed trips give the CRM dashboard a revenue history to read.
    addBooking(db, { code: 'AG-7K2M4Q', customerId: users.meron, driverId: drivers.dawit, pickup: 'Bole International Airport, Terminal 2', pLat: 8.9779, pLng: 38.7993, dropoff: 'Bole Medhanialem Church', dLat: 8.995, dLng: 38.787, class: 'e2', status: 'completed', rating: 5, review: 'Smooth, quiet ride. Dawit knew a shortcut around the airport traffic.', createdAt: daysAgo(1, 5), acceptedAt: daysAgo(1, 4), completedAt: daysAgo(1, 4), notes: 'Two large suitcases.' });
    addBooking(db, { code: 'AG-9P4X2B', customerId: users.abel, driverId: drivers.hanna, pickup: 'Piassa, Churchill Avenue', pLat: 9.034, pLng: 38.75, dropoff: 'Meskel Square', dLat: 9.01, dLng: 38.761, class: 'comfort', status: 'completed', rating: 5, review: 'Great conversation and a very clean car.', createdAt: daysAgo(2, 7), acceptedAt: daysAgo(2, 6), completedAt: daysAgo(2, 6) });
    addBooking(db, { code: 'AG-3F8N6T', customerId: users.meron, driverId: drivers.yonas, pickup: 'Meskel Square', pLat: 9.01, pLng: 38.761, dropoff: 'Entoto Natural Park', dLat: 9.07, dLng: 38.765, class: 'e2', status: 'completed', rating: 4, review: 'Beautiful drive up the mountain. Would ride again.', createdAt: daysAgo(4, 4), acceptedAt: daysAgo(4, 3), completedAt: daysAgo(4, 3) });
    addBooking(db, { code: 'AG-5R1W9A', customerId: users.liya, driverId: drivers.marta, pickup: 'Megenagna, Ring Road', pLat: 9.02, pLng: 38.801, dropoff: 'CMC Roundabout', dLat: 9.019, dLng: 38.827, class: 'comfort', status: 'completed', rating: 4, review: 'On time and friendly.', createdAt: daysAgo(5, 2), acceptedAt: daysAgo(5, 3), completedAt: daysAgo(5, 2) });
    addBooking(db, { code: 'AG-8T5Y3E', customerId: users.jake, driverId: drivers.bereket, pickup: 'Sarbet, Ethio-China Road', pLat: 9.0, pLng: 38.735, dropoff: 'Bole International Airport', dLat: 8.9779, dLng: 38.7993, class: 'van', status: 'completed', rating: 5, review: 'Plenty of room for four bags. Made the flight with time to spare.', createdAt: daysAgo(6, 4), acceptedAt: daysAgo(6, 5), completedAt: daysAgo(6, 4), notes: 'Four suitcases, international departure.' });
    addBooking(db, { code: 'AG-2C6V7U', customerId: users.abel, driverId: drivers.rahel, pickup: 'Kazanchis, ECA Road', pLat: 9.014, pLng: 38.762, dropoff: 'Piassa, Churchill Avenue', dLat: 9.034, dLng: 38.75, class: 'comfort', status: 'completed', rating: 4, review: 'Good route, avoided the ring road jam.', createdAt: daysAgo(7, 3), acceptedAt: daysAgo(7, 4), completedAt: daysAgo(7, 3) });
    addBooking(db, { code: 'AG-6N8B1D', customerId: users.meron, driverId: drivers.lidya, pickup: 'Bole Medhanialem Church', pLat: 8.995, pLng: 38.787, dropoff: 'Kazanchis, ECA Road', dLat: 9.014, dLng: 38.762, class: 'e2', status: 'completed', createdAt: daysAgo(0, 6), acceptedAt: daysAgo(0, 5), completedAt: daysAgo(0, 5) });

    // Live requests so the driver dashboard has something to demo out of the box.
    addBooking(db, { code: 'AG-4H7J2L', customerId: users.abel, driverId: null, pickup: 'Kazanchis, ECA Road', pLat: 9.014, pLng: 38.762, dropoff: 'Bole International Airport', dLat: 8.9779, dLng: 38.7993, class: 'e2', status: 'requested', createdAt: daysAgo(0), notes: 'One carry-on bag.' });
    addBooking(db, { code: 'AG-1Q5Z8M', customerId: users.liya, driverId: null, pickup: 'Sarbet, Ethio-China Road', pLat: 9.0, pLng: 38.735, dropoff: 'Entoto Natural Park', dLat: 9.07, dLng: 38.765, class: 'comfort', status: 'requested', scheduledFor: addisTimeIn(1, 8, 30), createdAt: daysAgo(0, 1), notes: 'Sunrise hike, please pick me up at the gate.' });

    const tours = {};
    tours.entoto = addTour(db, {
      hostId: users.selam,
      title: 'Sunset over Entoto',
      description:
        'A slow golden-hour walk above the city. We start at the eucalyptus forest gate, follow the ridge trail to the viewpoint, then share coffee and injera at a family-run spot. Bring a light jacket — it gets breezy up here.',
      meeting: 'Entoto Natural Park — main gate',
      lat: 9.07,
      lng: 38.765,
      startsAt: addisTimeIn(1, 16, 0),
      duration: 90,
      capacity: 8,
      price: 950,
      theme: 'entoto',
    });
    tours.merkato = addTour(db, {
      hostId: users.nahom,
      title: 'Merkato spice & craft walk',
      description:
        "A guided loop through Africa's largest open-air market. We learn how berbere is blended, meet basket weavers, and finish with a tasting menu at a family kitchen. Small group, English and Amharic.",
      meeting: 'Merkato — Gate 1',
      lat: 9.035,
      lng: 38.733,
      startsAt: addisTimeIn(2, 9, 30),
      duration: 150,
      capacity: 6,
      price: 1500,
      theme: 'merkato',
    });
    tours.museum = addTour(db, {
      hostId: users.selam,
      title: 'Unity Park & museum morning',
      description:
        'Start with the palace grounds and Unity Park, then walk to the National Museum to meet Lucy. Tickets included, coffee stop on the way. Easy pace, mostly flat, ideal for first-time visitors.',
      meeting: 'Unity Park — main gate',
      lat: 9.02,
      lng: 38.76,
      startsAt: addisTimeIn(3, 10, 0),
      duration: 180,
      capacity: 10,
      price: 1200,
      theme: 'museum',
    });
    tours.bole = addTour(db, {
      hostId: users.nahom,
      title: 'Bole after dark: food crawl',
      description:
        'Four stops, four kitchens, one very full group. We try tibs, kitfo, and a modern Ethiopian tasting plate, then end at a rooftop for honey wine. Vegetarian route available — tell us when you join.',
      meeting: 'Bole Medhanialem Church',
      lat: 8.995,
      lng: 38.787,
      startsAt: addisTimeIn(1, 19, 0),
      duration: 180,
      capacity: 8,
      price: 1800,
      theme: 'bole',
    });

    const members = [
      [tours.entoto, users.selam, 72], [tours.entoto, users.meron, 48], [tours.entoto, users.jake, 20], [tours.entoto, users.liya, 8],
      [tours.merkato, users.nahom, 60], [tours.merkato, users.abel, 26],
      [tours.museum, users.selam, 50], [tours.museum, users.meron, 12],
      [tours.bole, users.nahom, 40], [tours.bole, users.jake, 18], [tours.bole, users.liya, 10], [tours.bole, users.abel, 4],
    ];
    for (const [tourId, userId, hours] of members) {
      db.run('INSERT OR IGNORE INTO tour_members (tour_id, user_id, joined_at) VALUES (?, ?, ?)', [tourId, userId, daysAgo(0, hours)]);
    }

    const chat = [
      [tours.entoto, users.selam, "Welcome everyone! We meet at the main gate at 4:00 PM. I'll be in a green AddisGo cap.", 30],
      [tours.entoto, users.meron, 'Perfect. Is the trail okay with normal sneakers?', 26],
      [tours.entoto, users.selam, 'Yes, trainers are fine. We walk about 3 km at an easy pace.', 24],
      [tours.entoto, users.jake, "Count me in. I'm staying near Bole, should I take a ride up?", 18],
      [tours.entoto, users.selam, 'A ride to the gate is easiest. Booking an E2 is around 300–400 ETB from Bole.', 16],
      [tours.merkato, users.nahom, 'Please wear closed shoes — the lanes can be uneven. Bring small cash for crafts.', 22],
      [tours.merkato, users.abel, 'Noted. Is photography okay inside the spice stalls?', 12],
      [tours.merkato, users.nahom, 'Ask first, but most vendors are happy to be photographed.', 9],
      [tours.museum, users.selam, 'Tickets are included in the price. We finish near the National Theatre, easy for a ride.', 10],
      [tours.bole, users.nahom, "Vegetarian? Reply here and I'll arrange the tasting plate for you.", 5],
    ];
    for (const [tourId, userId, body, hours] of chat) {
      db.run(
        "INSERT INTO messages (room_type, room_id, user_id, body, created_at) VALUES ('tour', ?, ?, ?, ?)",
        [tourId, userId, body, daysAgo(0, hours)],
      );
    }

    const notifications = [
      [users.meron, 'ride', 'Rate your ride with Lidya', 'Your Bole → Kazanchis trip is complete. How did it go?', 4],
      [users.meron, 'tour', 'You joined Sunset over Entoto', 'Selam posted the meeting details in the group chat.', 20],
      [users.admin, 'driver', 'A driver is waiting for review', 'Samuel Girma submitted an E2 driver application.', 2],
      [users.abel, 'ride', 'Your ride request is live', 'Nearby E2 drivers have been notified. We will update you when one accepts.', 0],
    ];
    for (const [userId, kind, title, body, hours] of notifications) {
      db.run(
        'INSERT INTO notifications (user_id, kind, title, body, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)',
        [userId, kind, title, body, daysAgo(0, hours)],
      );
    }

    db.run("INSERT INTO audit_log (actor_id, action, detail, created_at) VALUES (?, 'system.seed', ?, ?)", [
      users.admin,
      'Demo data seeded for AddisGo v1',
      nowIso(),
    ]);
    db.run("INSERT INTO meta (key, value) VALUES ('seeded_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [nowIso()]);
  });

  return { seeded: true, users: 16, drivers: 9, tours: 4, bookings: 9 };
}
