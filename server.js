'use strict';

require('dotenv').config({ path: require('path').join(__dirname, 'azure.env') });
require('dotenv').config();

const path      = require('path');
const fs        = require('fs');
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const os        = require('os');
const routes    = require('./src/routes');
const { router: authRouter } = require('./src/auth');

const app  = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Folder holding the built frontend (output of `npm run build` in ar-ui)
const DIST_DIR = process.env.FRONTEND_DIST
  ? path.resolve(process.env.FRONTEND_DIST)
  : path.join(__dirname, 'ar-ui', 'dist');

const HAS_DIST = fs.existsSync(path.join(DIST_DIR, 'index.html'));

/* ------------------------------------------------------------------ */
/*  Security headers                                                   */
/*  CSP is relaxed enough to allow the Google Fonts links in index.html */
/*  hsts: false — this server runs plain HTTP (no TLS cert).            */
/*  upgradeInsecureRequests: null — Helmet adds this to CSP by default, */
/*  which tells browsers to rewrite every http:// asset request on the  */
/*  page to https:// — fatal here since there's no TLS listener at all. */
/* ------------------------------------------------------------------ */
app.use(helmet({
  hsts: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      connectSrc:  ["'self'", 'https://generativelanguage.googleapis.com'],
      objectSrc:   ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors({
  origin:         process.env.ALLOWED_ORIGIN || '*',
  methods:        ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'X-Api-Key', 'Authorization'],
}));

app.use(express.json({ limit: '16kb' }));

/* ------------------------------------------------------------------ */
/*  Rate limiting — API only.                                          */
/*  Applying it globally would throttle static assets, since one page  */
/*  load pulls dozens of JS/CSS/font files.                            */
/* ------------------------------------------------------------------ */
const apiLimiter = rateLimit({
  windowMs:        60 * 1000,
  max:             1000,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests — slow down.' },
  skip:            (req) => req.path === '/ping',
});

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ── Auth routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);

app.use('/api', apiLimiter, routes);

/* ------------------------------------------------------------------ */
/*  Frontend                                                           */
/* ------------------------------------------------------------------ */
if (HAS_DIST) {
  // Hashed assets can be cached hard; index.html must never be cached.
  app.use(express.static(DIST_DIR, {
    index:   false,
    maxAge:  '1y',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store');
    },
  }));
}

// Unknown /api path -> JSON 404
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Anything else -> hand back index.html so client-side routing works.
// Written as middleware rather than app.get('*') so it behaves the same
// on Express 4 and 5 (Express 5 rejects the bare '*' pattern).
app.use((req, res) => {
  if (HAS_DIST && req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(DIST_DIR, 'index.html'));
  }
  return res.status(404).json({ error: 'Not found' });
});

/* ------------------------------------------------------------------ */
/*  Start                                                              */
/* ------------------------------------------------------------------ */
function localIPv4s() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

function onListen() {
  console.log('\n=========================================');
  console.log(`  Oracle AR API  →  listening on ${HOST}:${PORT}`);
  console.log('=========================================');
  console.log(`  Local    : http://localhost:${PORT}`);
  localIPv4s().forEach((ip) => console.log(`  Network  : http://${ip}:${PORT}`));
  if (process.env.PUBLIC_URL) console.log(`  Public   : ${process.env.PUBLIC_URL}`);
  console.log('-----------------------------------------');
  console.log('  GET  /health');
  console.log('  GET  /api/ping');
  console.log('  GET  /api/business-groups');
  console.log('  GET  /api/operating-units?bgId=');
  console.log('  GET  /api/dashboard?bgId=&orgId=');
  console.log('  GET  /api/customer-balance?bgId=&orgId=');
  console.log('  GET  /api/project-balance?bgId=&orgId=');
  console.log('  GET  /api/aging-buckets?bgId=&orgId=');
  console.log('  POST /api/customer-detail');
  console.log('  POST /api/customer-info');
  console.log('-----------------------------------------');
  console.log(`  DB   : ${process.env.DB_USER}@${process.env.DB_HOST}:${process.env.DB_PORT || 1521}/${process.env.DB_SERVICE}`);
  console.log(`  CORS : ${process.env.ALLOWED_ORIGIN || '*'}`);
  console.log(`  AUTH : JWT ${process.env.JWT_SECRET ? '(custom secret)' : '(default secret)'}}`);
  console.log(`  UI   : ${HAS_DIST ? DIST_DIR : 'NOT BUILT — run `npm run build` in ar-ui'}`);
  console.log('=========================================\n');
}

// Azure Windows uses a named pipe for PORT — do not bind 0.0.0.0 there.
if (process.env.WEBSITE_SITE_NAME) {
  app.listen(PORT, onListen);
} else {
  app.listen(PORT, HOST, onListen);
}

module.exports = app;