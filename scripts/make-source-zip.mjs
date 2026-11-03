// Packs the whole source code of Chess for All into source.zip in the project folder, for the
// "Download the source code" button. Needs only Node.js (version 22 or newer), no packages:
//
//   node scripts/make-source-zip.mjs
//
// Left out: node_modules, Git and Vercel folders, test files, screenshots and source.zip itself.
// Run it again after changing any file, so the download matches the site.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'source.zip');

const SKIP_DIRS = new Set(['node_modules', '.git', '.vercel', 'test', 'tests', '__tests__', 'screenshots', 'shots']);
const SKIP_FILES = [
  /^source\.zip$/i,
  /\.(test|spec)\.[cm]?js$/i, // test files
  /screenshot/i, // screenshots
  /^\.DS_Store$/, /^Thumbs\.db$/i, /^desktop\.ini$/i,
];

function listFiles(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...listFiles(path.join(dir, entry.name), rel));
    } else if (entry.isFile() && !SKIP_FILES.some((re) => re.test(entry.name))) {
      out.push(rel);
    }
  }
  return out;
}

// MS-DOS date and time, as the zip format stores them.
function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

const files = listFiles(ROOT);
const parts = [];
const central = [];
let offset = 0;

for (const rel of files) {
  const data = fs.readFileSync(path.join(ROOT, rel));
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const stored = packed.length >= data.length; // already compressed (e.g. PNG): keep as it is
  const body = stored ? data : packed;
  const name = Buffer.from(rel, 'utf8');
  const crc = zlib.crc32(data);
  const { time, date } = dosTime(fs.statSync(path.join(ROOT, rel)).mtime);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); // local file header
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0x0800, 6); // file names are UTF-8
  local.writeUInt16LE(stored ? 0 : 8, 8); // stored or deflate
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  parts.push(local, name, body);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0); // central directory header
  entry.writeUInt16LE(20, 4); // made by
  entry.writeUInt16LE(20, 6); // version needed
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(stored ? 0 : 8, 10);
  entry.writeUInt16LE(time, 12);
  entry.writeUInt16LE(date, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(body.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(offset, 42); // where the local header starts
  central.push(entry, name);

  offset += local.length + name.length + body.length;
}

const centralSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); // end of central directory
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

fs.writeFileSync(OUT, Buffer.concat([...parts, ...central, end]));
console.log(`source.zip: ${files.length} files, ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB`);
