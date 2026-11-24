const express = require('express');
const router = express.Router();
const Report = require('../models/Report');

// POST /api/report  — recebe dados do client
router.post('/', async (req, res) => {
    try {
        const { deviceId, sentAt, records } = req.body;

        if (!deviceId || !Array.isArray(records) || records.length === 0)
            return res.status(400).json({ error: 'Payload inválido' });

        await Report.create({ deviceId, sentAt, records });
        res.json({ ok: true, received: records.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro interno' });
    }
});

// GET /api/report/:deviceId — busca histórico de um device
router.get('/:deviceId', async (req, res) => {
    try {
        const reports = await Report.find({ deviceId: req.params.deviceId })
            .sort({ sentAt: -1 })
            .limit(100);
        res.json(reports);
    } catch (err) {
        res.status(500).json({ error: 'Erro interno' });
    }
});

module.exports = router;