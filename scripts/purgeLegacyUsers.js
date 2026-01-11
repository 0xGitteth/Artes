import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_PATH = path.join(__dirname, '..', 'server', 'data', 'users.json');

const emptyPayload = { users: [], profiles: {} };

if (!fs.existsSync(USERS_PATH)) {
  fs.mkdirSync(path.dirname(USERS_PATH), { recursive: true });
}

fs.writeFileSync(USERS_PATH, JSON.stringify(emptyPayload, null, 2));

console.log('Legacy users verwijderd zonder backup.');
