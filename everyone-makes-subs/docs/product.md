# Everyone Makes Subs — Product overview

*Live captions & translation for every stage of your conference.*

> Project for the Nerdearla Vibeathon 2026.

## What it is

**Everyone Makes Subs** is an open source system that listens to every room at a conference and shows each attendee, on their phone, what the speaker is saying, in the original language or translated. It is installed by someone from the production team, not a developer: download it, open it, paste a Google API key, and you are done.

## How it works

Think of it as if each room had its own invisible three-person team:

1. **The listener:** takes the room's audio and passes it to Gemini. The audio can come from a laptop connected to the mixing console, from a YouTube link or from a file.
2. **The writer and translator:** Gemini writes down what it hears in real time. When the speaker finishes a sentence (or a long part of a sentence), it is translated into the chosen languages, respecting the technical vocabulary of that talk.
3. **The distributor:** sends each sentence to everyone watching, whether that is 10 or 10,000 people.

**Each room is processed only once**, no matter who is watching. That is why the cost does not grow with the audience.

## Who uses it and how

| Person | What they do | What they see |
|---|---|---|
| **Attendee** | Scans the room's QR code. Nothing else: the language is picked automatically based on their phone | Large captions, a "speaking…" indicator, the history and a summary of the last few minutes |
| **Production operator** | Installs the app, pastes the key, pastes the agenda and connects each room | One card per room that says in plain language whether it is working, with the sound level and the last sentence written |
| **Room technician** | Opens a link on the laptop connected to the mixing console and chooses the audio input | A large VU meter and a "Sending ✓" |
| **Streaming team** | Copies a URL from the Dashboard and pastes it into OBS | Captions with a transparent background over the video |
| **Room screen (TV mode)** | Opens TV mode | Two huge lines and a QR code in the corner: "Captions in your language" |

## A day at the event

**The night before:** the operator installs the app on the production laptop and opens it. A wizard asks for the Gemini key (with the steps to get one) and a password. Then the operator pastes the agenda exactly as it appears on the Nerdearla website: the system builds the rooms, the talks and the schedule, and automatically prepares the vocabulary for each talk ("Kubernetes", "pull request", the speakers' names). The QR codes are printed.

**Before doors open:** in each room, the technician opens the station link on a laptop plugged into the mixing console, chooses the input and watches the VU meter move. In the Dashboard, that room switches to "Live".

**During:** people scan and read. When it is time for the next talk, the Dashboard asks "Move to the next one?". If the sound cuts out, the Dashboard flags it ("No audio in Room 3") and the attendee's phone shows "Waiting for audio", not an error. If the connection to Gemini drops, the system reconnects on its own.

**After:** the transcript of each talk can be downloaded as SRT, VTT or text, ready to upload to YouTube.

## The hard problems and how we tackle them

| Problem | How we tackle it |
|---|---|
| When does a sentence end, so it can be translated? | When Gemini confirms it, when a period appears or, if the speaker talks without pausing, at the last comma after about 8 words. It never waits more than 4.5 s |
| Captions that "jump" | The original is written in gray as it comes in and becomes fixed once it is confirmed. The translation only appears once confirmed. Meanwhile, the phone shows "speaking…" so it does not look stuck |
| Gemini drops the connection every 10 minutes | The system opens a new connection a little ahead of time and switches during a pause by the speaker. It is designed to go unnoticed, and we test it by forcing switches every 60 s |
| Technical jargon | Automatic vocabulary per talk, used both when listening and when translating. The Dashboard shows how many times each term was recognized |
| The speaker mixes Spanish and English | The language of each sentence is detected. Anything already in the target language is not "translated" |
| Applause, silence, music | Filtered out and shown as a discreet icon. No audio is sent during silences, which also saves money |
| Phones need to reach the system | A secure public address (https) with Tailscale, for free, or with Cloudflare and your own domain. The QR codes use it |
| People watching on YouTube are behind | The overlay is added in OBS with a small delay, and the web view has a "delay" control |
| The laptop restarts | Rooms, agenda and glossaries are saved. When the app opens, it picks up where it left off |

## Why it is different

- **It is used by someone who is not a developer**: installer, first-run setup wizard, pasted agenda and a Dashboard in plain language.
- **Quality on technical terms**: automatic vocabulary per talk, and you can see it working.
- **Honest about latency**: the measured delay is visible, with the median and the usual worst case.
- **The translation never "jumps"**.
- **Everything a real event needs**: OBS overlay, room screen, caption export and Portuguese included.
- **A demo video captioned in English by the system itself**.

## What it costs

About **US$1 per hour per room** with two translation languages. A full day of Nerdearla (10 rooms, 9 hours) would cost about **US$90–100**, with any number of viewers. The "What did I miss?" summary is generated once per room and not per person, so it does not add cost per attendee either.

The free tier is enough for the demo, but on the free tier Google uses the content to improve its products. For a real event, enable billing.

> These are estimates based on the prices Google published in September 2026. Preview models may change price.

## Limits worth stating

- Without code signing, Mac and Windows show a warning the first time the app is opened. The README explains how to proceed.
- If everything runs on one laptop, that laptop is the single point of failure. For large events, the same system runs on a server with Docker.
- It does not distinguish between speakers (there is no live diarization). Audience questions only show up if they reach the mixing console.
