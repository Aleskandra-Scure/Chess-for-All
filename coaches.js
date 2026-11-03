// The coaches the player can choose: pictures and voices. Names, descriptions and each coach's
// own sentences are in i18n.js (STRINGS.<lang>.coaches and STRINGS.<lang>.lines).
//
// Pictures: `images.path` + mood + `images.ext`, e.g. ./avatars/viktor/happy.svg.
// To use your own pictures, put files with the same mood names in the folder
// (neutral, happy, worried, thinking, celebrate) and change `path` / `ext` here (e.g. ext: '.png').
//
// voice: pitch (0–2, 1 = normal) and rate (0.1–10, 1 = normal) for the browser's speech.

export const DEFAULT_COACH = 'viktor';

export const COACHES = [
  { id: 'viktor', voice: { pitch: 0.75, rate: 0.85 }, images: { path: './avatars/viktor/', ext: '.svg' } },
  { id: 'r7', voice: { pitch: 0.55, rate: 1.0 }, images: { path: './avatars/r7/', ext: '.svg' } },
  { id: 'kai', voice: { pitch: 0.9, rate: 0.9 }, images: { path: './avatars/kai/', ext: '.svg' } },
  { id: 'blitz', voice: { pitch: 1.25, rate: 1.15 }, images: { path: './avatars/blitz/', ext: '.svg' } },
  { id: 'gambit', voice: { pitch: 0.95, rate: 0.95 }, images: { path: './avatars/gambit/', ext: '.svg' } },
];

export const MOODS = ['neutral', 'happy', 'worried', 'thinking', 'celebrate'];

export function coachById(id) {
  return COACHES.find((c) => c.id === id) || COACHES.find((c) => c.id === DEFAULT_COACH);
}

export const coachImage = (coach, mood) => `${coach.images.path}${mood}${coach.images.ext}`;
