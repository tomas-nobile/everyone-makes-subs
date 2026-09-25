# Installers

| File | For | Notes |
|---|---|---|
| `EveryoneMakesSubs-1.0.0-win-x64.exe` (139 MB, stored with Git LFS) | Windows 10/11 | Unsigned: *Windows protected your PC* → **More info** → **Run anyway**. It opens the setup wizard (key → password → access → rooms). |

The same file, plus the videos, is on the [GitHub Release v1.0.0](https://github.com/tomas-nobile/everyone-makes-subs/releases/tag/v1.0.0):

- [EveryoneMakesSubs-1.0.0-win-x64.exe](https://github.com/tomas-nobile/everyone-makes-subs/releases/download/v1.0.0/EveryoneMakesSubs-1.0.0-win-x64.exe)
- [EveryoneMakesSubs-pitch.mp4](https://github.com/tomas-nobile/everyone-makes-subs/releases/download/v1.0.0/EveryoneMakesSubs-pitch.mp4) — the pitch video (2:38) and [the Spanish VTT](https://github.com/tomas-nobile/everyone-makes-subs/releases/download/v1.0.0/fosdem-2025-kubernetes-emissions-clip.es.vtt) its clip's subtitles came from

No Mac/Linux build yet: run `npm run app:dist` inside `everyone-makes-subs/` on that OS (it produces a `.dmg` / `.AppImage` in `app/release/`), or use Docker (`docker compose up --build` in the same folder).
