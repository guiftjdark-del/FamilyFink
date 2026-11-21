require('dotenv').config();
const express = require('express');
const { connectDb } = require('./db');
const reportRoute = require('./routes/report');

const app = express();
app.use(express.json({ limit: '5mb' }));

app.use('/api/report', reportRoute);

app.get('/', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;

connectDb().then(() => {
    app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
});