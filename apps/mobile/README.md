# D7 Mobile (Capacitor)

Wraps the D7 React frontend as a native iOS and Android app via [Capacitor 6](https://capacitorjs.com).

The web app IS the UI — Capacitor bridges native device APIs (push notifications, share sheet) to the web layer.

## Prerequisites

- **Node** ≥ 18
- **iOS**: macOS + Xcode ≥ 15 + CocoaPods (`sudo gem install cocoapods`)
- **Android**: Android Studio (Ladybug or later) + JDK 17

## Setup

```bash
# 1. Build the frontend first
cd ../../frontend
npm install && npm run build
cd ../apps/mobile

# 2. Install Capacitor deps
npm install

# 3. Add platforms (first time only)
npx cap add ios
npx cap add android

# 4. Sync web assets into native projects
npx cap sync
```

## Run / Open

```bash
# Open in Xcode (then Run → select simulator or device)
npx cap open ios

# Open in Android Studio (then Run → select device/emulator)
npx cap open android

# Or run directly (requires connected device or running simulator)
npx cap run ios
npx cap run android
```

## Push Notifications (deadline alerts)

Handled via `@capacitor/push-notifications`. Integration steps:

1. **iOS**: Enable Push Notifications capability in Xcode → Signing & Capabilities
2. **Android**: Add `google-services.json` (from Firebase Console) to `android/app/`
3. Register the device token in the D7 backend on app launch:

```typescript
import { PushNotifications } from '@capacitor/push-notifications';

await PushNotifications.requestPermissions();
await PushNotifications.register();
PushNotifications.addListener('registration', (token) => {
  // POST token to /api/v1/notifications/register
});
```

## Share Sheet

```typescript
import { Share } from '@capacitor/share';

await Share.share({
  title: 'D7 Dispatch',
  text: 'Check this task deadline',
  url: 'https://dispatch-seven.netlify.app/tasks/123',
  dialogTitle: 'Share via',
});
```

## Config

- `capacitor.config.ts` — appId, webDir, live-reload server URL, plugin options
- Swap `server.url` to your production Netlify URL before release builds
