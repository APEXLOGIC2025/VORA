// Vercel Serverless Function — VORA Push Notifications
// Runs when called, checks Firebase for due reminders and sends FCM push

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

// ── Generate OAuth2 access token from service account ──────────────────────
async function getAccessToken() {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(JSON.stringify({
    iss: FIREBASE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  // Import private key
  const pemKey = FIREBASE_PRIVATE_KEY;
  const keyData = pemKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');

  const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${header}.${payload}.${sig}`;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// ── Send FCM push notification ─────────────────────────────────────────────
async function sendPush(token, title, body, accessToken) {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          webpush: {
            notification: {
              title,
              body,
              icon: '/icon.png',
              badge: '/icon.png',
              requireInteraction: true,
              vibrate: [200, 100, 200]
            },
            fcm_options: { link: 'https://apex-vora.vercel.app' }
          }
        }
      })
    }
  );
  return res.json();
}

// ── Get Firebase data ───────────────────────────────────────────────────────
async function getFirebaseData(path, accessToken) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${path}`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );
  return res.json();
}

async function getRealtimeData(path) {
  const res = await fetch(
    `https://vora-bcc0b-default-rtdb.firebaseio.com/${path}.json`
  );
  return res.json();
}

async function updateRealtimeData(path, data) {
  await fetch(
    `https://vora-bcc0b-default-rtdb.firebaseio.com/${path}.json`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }
  );
}

// ── Main handler ────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Allow CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  try {
    if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
      return res.status(500).json({ error: 'Firebase env vars not configured' });
    }

    const accessToken = await getAccessToken();
    const now = Date.now();
    const sent = [];
    const errors = [];

    // Read all reminders from Firebase
    const reminders = await getRealtimeData('reminders');

    if (!reminders) {
      return res.status(200).json({ message: 'No reminders found', sent: 0 });
    }

    // Check each user's reminders
    for (const [userId, userReminders] of Object.entries(reminders)) {
      if (!userReminders) continue;

      for (const [remId, rem] of Object.entries(userReminders)) {
        if (!rem || rem.sent || !rem.fcmToken) continue;

        const fireAt = new Date(rem.fireAt).getTime();
        const windowMs = 5 * 60 * 1000; // 5-minute window

        if (Math.abs(now - fireAt) <= windowMs) {
          try {
            await sendPush(rem.fcmToken, rem.title, rem.body, accessToken);
            // Mark as sent
            await updateRealtimeData(`reminders/${userId}/${remId}`, { sent: true, sentAt: new Date().toISOString() });
            sent.push({ userId, remId, title: rem.title });
          } catch (err) {
            errors.push({ userId, remId, error: err.message });
          }
        }
      }
    }

    return res.status(200).json({
      message: `Processed ${sent.length} notifications`,
      sent,
      errors,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('Notify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
