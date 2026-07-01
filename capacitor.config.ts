import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.acmp.aircompressor',
  appName: 'A-CMP',
  webDir: 'out',
  server: {
    androidScheme: 'https',
    allowNavigation: ['*.vercel.app'],
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
