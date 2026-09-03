# Buzzer

Shared live buzzers: **Safe**, **Be careful**, and **Alert**.

## How to use

1. Open the site.
2. Use **Send** to tap a buzzer.
3. On another phone or laptop, open the same room and switch to **Receive**.
4. Tap **Enable sound** once on Receive (phones block audio until you tap).
5. When someone sends a buzzer, Receive plays the voice-over and lights the active status.

Share a receive link like `?tab=receive&room=your-room`.

## Deploy

Static site. Import the GitHub repo on Vercel. No env vars.

Realtime uses MQTT (HiveMQ public broker) plus ntfy, so two phones on the same room stay in sync.
