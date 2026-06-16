/**
 * v0.2.5 Phase 4.5 — backend worldmaps route.
 *
 * Stores ARWorldMap binary blobs by spaceId. Phase 4 ships filesystem-backed
 * storage in `backend/storage/v025/worldmaps/`; future v0.2.6 may swap to
 * Aliyun OSS / S3 — the route surface stays the same, only the storage helper
 * changes.
 *
 * Endpoints:
 *   POST /api/v025/worldmaps/:spaceId
 *     auth: required (markers + worldmaps must always be associated with a user)
 *     body: octet-stream binary
 *     response: { spaceId, sizeBytes, savedAt }
 *
 *   GET /api/v025/worldmaps/:spaceId
 *     auth: required
 *     response: 200 + binary blob OR 404 if not found
 *
 * Round-1 4-eye expectation (Phase 3 §3-2-A pattern): rate-limited.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();
const authenticate = require('../../middleware/authenticate');

const STORAGE_ROOT = path.join(__dirname, '..', '..', '..', 'storage', 'v025', 'worldmaps');
const MAX_BLOB_BYTES = 50 * 1024 * 1024; // 50 MB hard cap per blob
const ALLOWED_SPACE_ID = /^[a-zA-Z0-9_\-.]{1,64}$/;

function ensureDir() {
    if (!fs.existsSync(STORAGE_ROOT)) {
        fs.mkdirSync(STORAGE_ROOT, { recursive: true });
    }
}

const writeRl = rateLimit({
    windowMs: 60 * 1000,
    max: 30, // 30 saves/min/IP — saves are heavy
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, res) => ipKeyGenerator(req, res),
});

const readRl = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, res) => ipKeyGenerator(req, res),
});

router.post('/worldmaps/:spaceId', writeRl, authenticate, express.raw({ type: 'application/octet-stream', limit: MAX_BLOB_BYTES }), (req, res) => {
    const { spaceId } = req.params;
    if (!ALLOWED_SPACE_ID.test(spaceId)) {
        return res.status(400).json({ error: 'invalid_space_id' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: 'empty_body' });
    }
    if (req.body.length > MAX_BLOB_BYTES) {
        return res.status(413).json({ error: 'too_large', max: MAX_BLOB_BYTES });
    }
    try {
        ensureDir();
        const file = path.join(STORAGE_ROOT, spaceId + '.arworldmap');
        fs.writeFileSync(file, req.body);
        return res.json({
            spaceId,
            sizeBytes: req.body.length,
            savedAt: new Date().toISOString(),
        });
    } catch (err) {
        console.error('[v025/worldmaps] save failed:', err.code, err.message);
        return res.status(500).json({ error: 'save_failed', code: err.code || 'unknown' });
    }
});

router.get('/worldmaps/:spaceId', readRl, authenticate, (req, res) => {
    const { spaceId } = req.params;
    if (!ALLOWED_SPACE_ID.test(spaceId)) {
        return res.status(400).json({ error: 'invalid_space_id' });
    }
    const file = path.join(STORAGE_ROOT, spaceId + '.arworldmap');
    if (!fs.existsSync(file)) {
        // Round-1 #4-2-B: empty 404 body so expo-file-system downloadAsync
        // doesn't write a JSON document to the .arworldmap localUri. Empty body
        // makes it safe even if the client doesn't check status before consuming.
        res.status(404);
        res.set('Content-Length', '0');
        return res.end();
    }
    try {
        const data = fs.readFileSync(file);
        res.set('Content-Type', 'application/octet-stream');
        res.set('Content-Length', String(data.length));
        return res.send(data);
    } catch (err) {
        console.error('[v025/worldmaps] read failed:', err.code, err.message);
        return res.status(500).json({ error: 'read_failed', code: err.code || 'unknown' });
    }
});

module.exports = router;
