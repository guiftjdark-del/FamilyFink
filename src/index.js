require('dotenv').config();
const path = require('path');
const express = require('express');
const { connectDb } = require('./db');
const reportRoute = require('./routes/report');
const dashboardRoute = require('./routes/dashboard');

const app = express();
app.use(express.json({ limit: '5mb' }));

app.use('/api/report', reportRoute);
app.use('/api/dashboard', dashboardRoute);

// Painel web em /painel
app.use('/painel', express.static(path.join(__dirname, '..', 'public', 'painel')));

app.get('/', (_, res) => res.json({ ok: true, painel: '/painel' }));

const PORT = process.env.PORT || 3000;

connectDb()
    .then(() => {
        app.listen(PORT, () => console.log(`Rodando na porta ${PORT} — painel em http://localhost:${PORT}/painel`));
    })
    .catch((err) => {
        console.error(`\n[FamilyFink] Falha ao conectar no MongoDB: ${err.message}\n`);
        process.exit(1);
    });
