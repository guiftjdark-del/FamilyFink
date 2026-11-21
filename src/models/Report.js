const mongoose = require('mongoose');

const recordSchema = new mongoose.Schema({
    type: String,          // "browser" | "app" | "activity"
    payload: mongoose.Schema.Types.Mixed,
    savedAt: Date,
}, { _id: false });

const reportSchema = new mongoose.Schema({
    deviceId: { type: String, index: true },
    sentAt: Date,
    records: [recordSchema],
}, { timestamps: true });

module.exports = mongoose.model('Report', reportSchema);