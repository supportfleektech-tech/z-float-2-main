import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zfloat.app',
  appName: 'Z-float',
  webDir: 'out',
  server: {
    url: process.env.CAPACITOR_SERVER_URL || 'http://localhost:3000',
    cleartext: true,
  },
  ios: {
    scheme: 'zfloat',
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0F5BFF',
      showSpinner: false,
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0F5BFF',
    },
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;