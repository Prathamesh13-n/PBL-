Pothole Guard — Drive Safe / Pune Sadak Suraksha

Two options are included:
- `index.html` + `main.js` — client-only demo with localStorage and proximity alerts.
- `pune.html` + Node/Express backend — shared reports with photo upload.

Run the backend (for pune.html)
1) Install Node.js 18+.
2) In PowerShell:
```powershell
cd "D:\New folder\codes"
npm install
npm run start
```
Server starts at `http://localhost:3000`.

Open the app
- For backend version: open `http://localhost:3000/pune.html`
- For client-only version: just open `index.html` directly or via a static server.

Notes
- Uploaded images are stored in `/uploads`; data is stored in `data/potholes.json`.
- API endpoints:
  - GET `/api/potholes` — list all
  - POST `/api/potholes` — multipart form fields: `lat`, `lng`, `size`, `description`, optional file: `photo`
  - PATCH `/api/potholes/:id` — JSON body `{ "status": "new|progress|repaired" }`
  - DELETE `/api/potholes/:id`


