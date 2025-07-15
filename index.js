import express from 'express';
import fileUpload from 'express-fileupload';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import xlsx from 'xlsx';
import open from "open";

const __dirname = path.resolve();
const app = express();
const PORT = 3000;

const DB_PATH = path.join(__dirname, 'repricer-db.json');
const git = simpleGit();

app.use(cors());
app.use(fileUpload());
app.use(express.static(path.join(__dirname, 'public')));

// === Чтение БД (массив объектов)
function readDb() {
    if (!fs.existsSync(DB_PATH)) return [];
    try {
        const raw = fs.readFileSync(DB_PATH, 'utf8');
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) throw new Error('JSON is not array');
        return data;
    } catch (err) {
        console.error('❌ Ошибка чтения repricer-db.json:', err.message);
        return [];
    }
}

// === Запись БД
async function writeDb(data, commitMessage) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');

    try {
        await git.add(DB_PATH);
        await git.commit(commitMessage);
        await git.push();
        console.log('✅ Изменения запушены в GitHub: ' + commitMessage);
        return { success: true };
    } catch (err) {
        console.error('❌ Ошибка при пуше в GitHub:', err.message);
        return { success: false, error: err.message };
    }
}

// === Парсер строк с ID
function parseIds(str) {
    return typeof str === 'string' ? str.split(/[,;:\\-\\.\\s]+/).filter(Boolean) : [];
}

// === Добавление / обновление данных
app.post('/upload-data', async (req, res) => {
    if (!req.files || !req.files.file) return res.status(400).send('Нет файла');

    const buffer = req.files.file.data;
    const workbook = xlsx.read(buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    let db = readDb();

    for (const row of rows) {
        if (!row.ID) continue;

        const newItem = {
            ID: String(row.ID),
            EtalonPrice: row.EtalonPrice || null,
            matchedIds: parseIds(row.matchedIds),
            rejectedIds: parseIds(row.rejectedIds),
        };

        const index = db.findIndex(item => item.ID === newItem.ID);
        if (index !== -1) {
        db[index] = newItem; // обновление
        } else {
        db.push(newItem); // добавление
        }
    }

    const result = await writeDb(db, 'Обновление базы данных');

    if (result.success) {
    console.log('✅ Загружено и сохранено в GitHub. Всего записей:', db.length);
    res.send({ status: 'ok', total: db.length, message: '✅ Загружено в GitHub' });
    } else {
    res.status(500).send({ status: 'error', message: '❌ Ошибка при пуше в GitHub: ' + result.error });
    }
});

// === Удаление по ID
app.post('/delete-ids', async (req, res) => {
    if (!req.files || !req.files.file) return res.status(400).send('Нет файла');

    const buffer = req.files.file.data;
    const workbook = xlsx.read(buffer);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet);

    let db = readDb();

    const idsToDelete = rows.map(row => String(row.ID)).filter(Boolean);
    db = db.filter(item => !idsToDelete.includes(item.ID));

    const result = await writeDb(db, 'Удаление записей');

    if (result.success) {
    console.log('🗑️ Удаление завершено. Осталось записей:', db.length);
    res.send({ status: 'deleted', total: db.length, message: '🗑️ Успешно удалено из GitHub' });
    } else {
    res.status(500).send({ status: 'error', message: '❌ Ошибка при удалении: ' + result.error });
    }
});

// === Скачать как Excel
app.get('/download-db', (req, res) => {
    // Преобразуем массивы в строки
    const db = readDb().map(item => ({
        ...item,
        matchedIds: Array.isArray(item.matchedIds) ? item.matchedIds.map(s => s.trim()).join(',') : '',
        rejectedIds: Array.isArray(item.rejectedIds) ? item.rejectedIds.map(s => s.trim()).join(',') : '',
    }));

    const sheet = xlsx.utils.json_to_sheet(db);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, sheet, 'RepricerDB');

    const tempPath = path.join(__dirname, `repricerDB-${Date.now()}.xlsx`);
    xlsx.writeFile(wb, tempPath);

    res.download(tempPath, () => fs.unlinkSync(tempPath));
});

// === Получить количество
app.get('/count', (req, res) => {
    const db = readDb();
    res.send({ total: db.length });
});

app.get('/sample-upload', (req, res) => {
    const filePath = path.join(__dirname, 'samples', 'sample-upload.xlsx');
    res.download(filePath, 'Шаблон-Загрузка.xlsx');
});

app.get('/sample-delete', (req, res) => {
    const filePath = path.join(__dirname, 'samples', 'sample-delete.xlsx');
    res.download(filePath, 'Шаблон-Удаление.xlsx');
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер работает: http://localhost:${PORT}`);
});

(async () => {
    await open(`http://localhost:${PORT}/`, { app: { name: "chrome" } });
})();