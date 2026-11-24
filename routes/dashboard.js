const express = require('express');
const router = express.Router();
const Report = require('../models/Report');

// Timestamp de um registro (cai para sentAt/createdAt quando savedAt não existe)
const TS_EXPR = { $ifNull: ['$records.savedAt', { $ifNull: ['$sentAt', '$createdAt'] }] };

function parseIntSafe(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/dashboard/overview — números gerais, dispositivos e série diária
router.get('/overview', async (req, res) => {
    try {
        const now = new Date();

        const since14 = new Date(now);
        since14.setUTCHours(0, 0, 0, 0);
        since14.setUTCDate(since14.getUTCDate() - 13);

        const since24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const [totalReports, typeAgg, deviceAgg, dailyAgg, last24Agg] = await Promise.all([
            Report.countDocuments(),
            Report.aggregate([
                { $unwind: '$records' },
                { $group: { _id: { $ifNull: ['$records.type', 'outro'] }, count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $project: { _id: 0, type: '$_id', count: 1 } },
            ]),
            Report.aggregate([
                { $unwind: { path: '$records', preserveNullAndEmptyArrays: true } },
                {
                    $group: {
                        _id: { $ifNull: ['$deviceId', 'sem-dispositivo'] },
                        reportIds: { $addToSet: '$_id' },
                        records: {
                            $sum: {
                                $cond: [{ $ne: [{ $ifNull: ['$records.type', null] }, null] }, 1, 0],
                            },
                        },
                        types: { $addToSet: '$records.type' },
                        lastSeen: { $max: { $ifNull: ['$sentAt', '$createdAt'] } },
                    },
                },
                {
                    $project: {
                        _id: 0,
                        deviceId: '$_id',
                        reports: { $size: '$reportIds' },
                        records: 1,
                        lastSeen: 1,
                        types: {
                            $filter: {
                                input: '$types',
                                as: 't',
                                cond: { $ne: ['$$t', null] },
                            },
                        },
                    },
                },
                { $sort: { lastSeen: -1 } },
            ]),
            Report.aggregate([
                { $unwind: '$records' },
                { $addFields: { ts: TS_EXPR } },
                { $match: { ts: { $gte: since14 } } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { _id: 1 } },
                { $project: { _id: 0, date: '$_id', count: 1 } },
            ]),
            Report.aggregate([
                { $unwind: '$records' },
                { $addFields: { ts: TS_EXPR } },
                { $match: { ts: { $gte: since24 } } },
                { $count: 'count' },
            ]),
        ]);

        const types = typeAgg || [];
        const devices = deviceAgg || [];

        res.json({
            totals: {
                reports: totalReports || 0,
                records: types.reduce((sum, t) => sum + (t.count || 0), 0),
                devices: devices.length,
                last24h: last24Agg?.[0]?.count || 0,
            },
            types,
            devices,
            daily: dailyAgg || [],
            generatedAt: now,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao carregar visão geral' });
    }
});

// GET /api/dashboard/records — registros paginados com filtros
router.get('/records', async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseIntSafe(req.query.limit, 25), 1), 200);
        const skip = Math.max(parseIntSafe(req.query.skip, 0), 0);
        const deviceId = String(req.query.deviceId || '').trim();
        const type = String(req.query.type || 'all').trim();
        const q = String(req.query.q || '').trim();

        const match = {};
        if (deviceId) match.deviceId = deviceId;

        const pipeline = [
            { $match: match },
            { $unwind: '$records' },
            { $addFields: { ts: TS_EXPR } },
        ];

        // O filtro de tipo precisa vir depois do $unwind, senão registros
        // de outros tipos do mesmo relatório também entram no resultado.
        if (type && type !== 'all') {
            pipeline.push({ $match: { 'records.type': type } });
        }

        if (q) {
            pipeline.push(
                {
                    $addFields: {
                        _payloadText: {
                            $reduce: {
                                input: {
                                    $map: {
                                        input: {
                                            $cond: [
                                                { $eq: [{ $type: '$records.payload' }, 'object'] },
                                                { $objectToArray: '$records.payload' },
                                                [],
                                            ],
                                        },
                                        in: {
                                            $convert: {
                                                input: '$$this.v',
                                                to: 'string',
                                                onError: '',
                                                onNull: '',
                                            },
                                        },
                                    },
                                },
                                initialValue: '',
                                in: { $concat: ['$$value', ' ', '$$this'] },
                            },
                        },
                    },
                },
                {
                    $match: {
                        $expr: {
                            $regexMatch: {
                                input: {
                                    $concat: [
                                        { $ifNull: ['$records.type', ''] },
                                        ' ',
                                        { $ifNull: ['$deviceId', ''] },
                                        ' ',
                                        '$_payloadText',
                                    ],
                                },
                                regex: escapeRegex(q),
                                options: 'i',
                            },
                        },
                    },
                }
            );
        }

        pipeline.push(
            { $sort: { ts: -1, _id: -1 } },
            {
                $facet: {
                    items: [
                        { $skip: skip },
                        { $limit: limit },
                        {
                            $project: {
                                _id: 0,
                                reportId: '$_id',
                                deviceId: 1,
                                sentAt: 1,
                                createdAt: 1,
                                type: '$records.type',
                                payload: '$records.payload',
                                ts: 1,
                            },
                        },
                    ],
                    total: [{ $count: 'count' }],
                },
            }
        );

        const [result] = await Report.aggregate(pipeline);

        res.json({
            items: result?.items || [],
            total: result?.total?.[0]?.count || 0,
            skip,
            limit,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao carregar registros' });
    }
});

module.exports = router;
