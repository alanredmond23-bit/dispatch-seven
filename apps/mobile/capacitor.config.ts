import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dispatch7.app',
  appName: 'D7',
  // Points to the pre-built Vite output when running `npx cap sync`
  webDir: '../../frontend/dist',
  server: {
    // For live-reload during development — swap for production Netlify URL
    url: 'https://dispatch-seven.netlify.app',
    cleartext: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    // Share sheet — lets users share dispatch links/deadlines from within the app
    Share: {},
  },
};

export default config;
