// F14.3: publishes the installers in app/release/ as a GitHub Release (no CI: build on each OS with
// `npm run app:dist`, then run this there to add that OS's file). Needs `gh` logged in and an
// `origin` remote. Creates the release v<version> the first time; later runs upload/replace files.
// Usage: npm run release [-- --dry-run]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string };
const tag = `v${pkg.version}`;
const dry = process.argv.includes('--dry-run');
const sh = (bin: string, args: string[]) => execFileSync(bin, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const dir = 'app/release';
const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.includes(pkg.version) && /\.(exe|dmg|AppImage|deb|zip)$/.test(f)).map((f) => path.join(dir, f))
  : [];
if (!files.length) {
  console.log(`No installers for ${pkg.version} in ${dir}/. Run \`npm run app:dist\` first.`);
  process.exit(1);
}

let remote = '';
try { remote = sh('git', ['remote', 'get-url', 'origin']); } catch { /* none */ }
if (!remote) {
  console.log('No `origin` remote. Create the GitHub repo first, e.g.:\n  gh repo create everyone-makes-subs --public --source . --push');
  process.exit(1);
}

const NOTES = `Everyone Makes Subs ${tag}: live captions and translation for every stage of your conference, with a single Gemini API key.

**Install:** download the file for your OS and open it. The app opens the setup wizard (key → password → access → rooms).

The installers are **unsigned**:
- **Windows:** "Windows protected your PC" → *More info* → *Run anyway*.
- **Mac:** right-click the app → *Open* → *Open* (only the first time).
- **Linux:** \`chmod +x EveryoneMakesSubs-*.AppImage\` and run it.

Prefer a server? \`docker compose up --build\` (see the README).`;

let exists = true;
try { sh('gh', ['release', 'view', tag]); } catch { exists = false; }

const cmd = exists
  ? ['release', 'upload', tag, ...files, '--clobber']
  : ['release', 'create', tag, ...files, '--title', `Everyone Makes Subs ${tag}`, '--notes', NOTES];
console.log(`${dry ? '[dry run] ' : ''}gh ${cmd.slice(0, 3).join(' ')} ${files.map((f) => path.basename(f)).join(' ')}`);
if (!dry) {
  execFileSync('gh', cmd, { stdio: 'inherit' });
  console.log(`Published: ${sh('gh', ['release', 'view', tag, '--json', 'url', '--jq', '.url'])}`);
}
