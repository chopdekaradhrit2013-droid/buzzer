# Buzzer

Shared live buzzers: **Safe**, **Be careful**, and **Alert**.

## How to use

1. Open the site.
2. Use the **Send** tab to tap a buzzer.
3. Open the same room on another phone/laptop and switch to **Receive**.
4. Tap **Enable sound** once on Receive (required by phones).
5. When someone sends a buzzer, Receive plays the voice-over and lights the active status.

Share a receive link with `?tab=receive&room=your-room`. Anyone on the same room hears the same signals.

## Deploy

This is a static site. On Vercel: Import the GitHub repo and deploy. No env vars needed.

Realtime uses a public ntfy topic namespaced per room.
