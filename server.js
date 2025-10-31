import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { nanoid } from 'nanoid';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(__dirname, 'uploads');
const dbFile = path.join(dataDir, 'potholes.json');

await fs.ensureDir(dataDir);
await fs.ensureDir(uploadsDir);
if (!(await fs.pathExists(dbFile))) {
  await fs.writeJson(dbFile, { potholes: [] }, { spaces: 2 });
}

// Static serving
app.use('/uploads', express.static(uploadsDir));
app.use('/', express.static(__dirname));

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${nanoid(8)}${ext || '.jpg'}`);
  }
});
const upload = multer({ storage });

async function readDb() {
  const json = await fs.readJson(dbFile).catch(() => ({ potholes: [] }));
  if (!json || !Array.isArray(json.potholes)) return { potholes: [] };
  return json;
}

async function writeDb(nextData) {
  const tmp = `${dbFile}.tmp`;
  await fs.writeJson(tmp, nextData, { spaces: 2 });
  await fs.move(tmp, dbFile, { overwrite: true });
}

// Routes
app.get('/api/potholes', async (req, res) => {
  const { potholes } = await readDb();
  res.json(potholes);
});

app.post('/api/potholes', upload.single('photo'), async (req, res) => {
  const { lat, lng, size, description } = req.body;
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
    return res.status(400).json({ error: 'Invalid lat/lng' });
  }
  const id = nanoid(12);
  const photoUrl = req.file ? `/uploads/${req.file.filename}` : null;
  const item = {
    id,
    lat: latNum,
    lng: lngNum,
    size: size || 'Medium',
    status: 'new',
    address: description ? `Near ${description}` : 'Reported location',
    reportedOn: new Date().toISOString().slice(0, 10),
    photoUrl
  };
  const db = await readDb();
  db.potholes.push(item);
  await writeDb(db);
  res.status(201).json(item);
});

app.patch('/api/potholes/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};
  const allowed = new Set(['new', 'progress', 'repaired']);
  if (status && !allowed.has(status)) return res.status(400).json({ error: 'Invalid status' });
  const db = await readDb();
  const idx = db.potholes.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.potholes[idx] = { ...db.potholes[idx], ...(status ? { status } : {}) };
  await writeDb(db);
  res.json(db.potholes[idx]);
});

app.delete('/api/potholes/:id', async (req, res) => {
  const { id } = req.params;
  const db = await readDb();
  const idx = db.potholes.findIndex(p => p.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = db.potholes.splice(idx, 1);
  await writeDb(db);
  res.json({ ok: true, removed });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


