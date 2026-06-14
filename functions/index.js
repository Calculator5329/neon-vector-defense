const crypto = require('crypto');
const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { GAME_KNOWLEDGE } = require('./gameKnowledge');

admin.initializeApp();
const db = admin.firestore();

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_MESSAGE_CHARS = 900;
const MAX_TURNS_PER_CONVERSATION = 5;
const MAX_CONVERSATIONS_PER_VISITOR = 5;
const MAX_CONVERSATIONS_PER_IP_HOUR = 20;
const MAX_TURNS_PER_IP_DAY = 100;

function json(res, status, body, extraHeaders = {}) {
  res.set({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.status(status).send(JSON.stringify(body));
}

function env(name, fallback = '') {
  return process.env[name] || fallback;
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function signVisitor(id) {
  const secret = env('AI_COOKIE_SECRET', env('OPENROUTER_API_KEY', 'dev-secret'));
  return crypto.createHmac('sha256', secret).update(id).digest('hex').slice(0, 32);
}

function parseCookie(header, name) {
  const cookies = String(header || '').split(';');
  for (const cookie of cookies) {
    const [rawKey, ...parts] = cookie.trim().split('=');
    if (rawKey === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

function getVisitor(req) {
  const raw = parseCookie(req.headers.cookie, 'nvd_ai');
  const [id, sig] = raw.split('.');
  if (id && sig && sig === signVisitor(id)) return { id, isNew: false };
  return { id: crypto.randomUUID(), isNew: true };
}

function visitorCookie(visitorId) {
  const secure = env('NODE_ENV') === 'production' ? '; Secure' : '';
  return `nvd_ai=${encodeURIComponent(`${visitorId}.${signVisitor(visitorId)}`)}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || 'unknown';
}

function hourBucket(date) {
  return date.toISOString().slice(0, 13).replace(/[-T:]/g, '');
}

function dayBucket(date) {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (origin === env('APP_URL', 'https://neon-vector-defense-7.web.app')) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

async function incrementBucket(ref, field, max, now) {
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.get(field) || 0) : 0;
    if (current >= max) return { ok: false, current };
    tx.set(ref, {
      [field]: current + 1,
      updatedAt: admin.firestore.Timestamp.fromMillis(now),
    }, { merge: true });
    return { ok: true, current: current + 1 };
  });
  return result;
}

function sanitizeHistory(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1400) }));
}

function publicMessage(content, role = 'assistant') {
  return { role, content: String(content || '').slice(0, 2400) };
}

exports.aiHelp = onRequest({
  region: 'us-central1',
  cors: false,
  timeoutSeconds: 45,
  secrets: ['OPENROUTER_API_KEY', 'AI_COOKIE_SECRET'],
}, async (req, res) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Credentials', 'true');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { error: 'method_not_allowed' });
    return;
  }

  const key = env('OPENROUTER_API_KEY');
  if (!key) {
    json(res, 503, { error: 'ai_not_configured', message: 'AI uplink is not configured yet.' });
    return;
  }

  const body = typeof req.body === 'object' && req.body ? req.body : {};
  const message = String(body.message || '').trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) {
    json(res, 400, { error: 'empty_message' });
    return;
  }

  const nowDate = new Date();
  const now = nowDate.getTime();
  const visitor = getVisitor(req);
  const ipHash = hash(clientIp(req));
  const cookieHeader = { 'Set-Cookie': visitorCookie(visitor.id) };
  const requestedConversationId = String(body.conversationId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  const conversationId = requestedConversationId || crypto.randomUUID();

  const ipDayRef = db.doc(`aiRate/ipDay_${ipHash}_${dayBucket(nowDate)}`);
  const day = await incrementBucket(ipDayRef, 'turns', MAX_TURNS_PER_IP_DAY, now);
  if (!day.ok) {
    json(res, 429, { error: 'rate_limited', message: 'Daily AI help limit reached for this network.' }, cookieHeader);
    return;
  }

  const visitorRef = db.doc(`aiVisitors/${visitor.id}`);
  const conversationRef = visitorRef.collection('conversations').doc(conversationId);
  const ipHourRef = db.doc(`aiRate/ipHour_${ipHash}_${hourBucket(nowDate)}`);

  let storedHistory = [];
  let turnNumber = 0;
  const quota = await db.runTransaction(async (tx) => {
    const [visitorSnap, conversationSnap, ipHourSnap] = await Promise.all([
      tx.get(visitorRef),
      tx.get(conversationRef),
      tx.get(ipHourRef),
    ]);
    const conversations = visitorSnap.exists ? Number(visitorSnap.get('conversations') || 0) : 0;
    const isNewConversation = !conversationSnap.exists;
    if (isNewConversation && conversations >= MAX_CONVERSATIONS_PER_VISITOR) {
      return { ok: false, reason: 'conversation_limit', conversations };
    }
    const ipHourConversations = ipHourSnap.exists ? Number(ipHourSnap.get('conversations') || 0) : 0;
    if (isNewConversation && ipHourConversations >= MAX_CONVERSATIONS_PER_IP_HOUR) {
      return { ok: false, reason: 'ip_hour_limit', conversations };
    }
    const turns = conversationSnap.exists ? Number(conversationSnap.get('turns') || 0) : 0;
    if (turns >= MAX_TURNS_PER_CONVERSATION) {
      return { ok: false, reason: 'turn_limit', conversations };
    }
    storedHistory = conversationSnap.exists ? sanitizeHistory(conversationSnap.get('messages')) : [];
    turnNumber = turns + 1;
    tx.set(visitorRef, {
      conversations: conversations + (isNewConversation ? 1 : 0),
      updatedAt: admin.firestore.Timestamp.fromMillis(now),
      createdAt: visitorSnap.exists ? visitorSnap.get('createdAt') : admin.firestore.Timestamp.fromMillis(now),
    }, { merge: true });
    if (isNewConversation) {
      tx.set(ipHourRef, {
        conversations: ipHourConversations + 1,
        updatedAt: admin.firestore.Timestamp.fromMillis(now),
      }, { merge: true });
    }
    tx.set(conversationRef, {
      turns: turnNumber,
      updatedAt: admin.firestore.Timestamp.fromMillis(now),
      createdAt: conversationSnap.exists ? conversationSnap.get('createdAt') : admin.firestore.Timestamp.fromMillis(now),
    }, { merge: true });
    return { ok: true, conversations: conversations + (isNewConversation ? 1 : 0) };
  });

  if (!quota.ok) {
    const messageText = quota.reason === 'turn_limit'
      ? 'This chat has reached its 5-turn limit. Start a new uplink from the menu.'
      : quota.reason === 'ip_hour_limit'
        ? 'AI uplink is busy from this network. Try again later.'
      : 'This browser has reached its AI conversation limit.';
    json(res, 429, { error: quota.reason, message: messageText }, cookieHeader);
    return;
  }

  const model = env('OPENROUTER_MODEL', 'google/gemini-3-flash-preview');
  const messages = [
    { role: 'system', content: GAME_KNOWLEDGE },
    ...storedHistory,
    { role: 'user', content: message },
  ];

  try {
    const aiRes = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': env('APP_URL', 'https://neon-vector-defense-7.web.app'),
        'X-Title': 'Neon Vector Defense AI Help',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.35,
        max_tokens: 520,
      }),
    });

    if (!aiRes.ok) {
      const detail = await aiRes.text();
      console.error('OpenRouter error', aiRes.status, detail.slice(0, 500));
      json(res, 502, { error: 'ai_failed', message: 'AI uplink failed. Try again in a moment.' }, cookieHeader);
      return;
    }

    const data = await aiRes.json();
    const reply = data?.choices?.[0]?.message?.content || 'I could not decode that signal. Try asking again.';
    const nextHistory = [...storedHistory, publicMessage(message, 'user'), publicMessage(reply)];
    await conversationRef.set({
      messages: nextHistory.slice(-10),
      model,
      updatedAt: admin.firestore.Timestamp.fromMillis(Date.now()),
    }, { merge: true });

    json(res, 200, {
      conversationId,
      reply,
      turnsRemaining: Math.max(0, MAX_TURNS_PER_CONVERSATION - turnNumber),
      conversationsRemaining: Math.max(0, MAX_CONVERSATIONS_PER_VISITOR - quota.conversations),
    }, cookieHeader);
  } catch (error) {
    console.error(error);
    json(res, 500, { error: 'server_error', message: 'AI uplink is offline.' }, cookieHeader);
  }
});
