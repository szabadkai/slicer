# Contributing

## UI Directives

- **Progress Bars & Yielding:** Make sure operations that might take along time are showing the user a progress bar. You must also guarantee that the browser has an opportunity to paint the UI progress bar text before any synchronous heavy work begins and during iterations of long tasks. Use `showProgress(text)` and `hideProgress()`, and make sure you yield the main thread right after using `await new Promise(r => setTimeout(r, 50))` so the browser paints the UI correctly. For loops traversing large arrays, periodically yield and update `onProgress` text or percentages to avoid freezing the browser canvas.
