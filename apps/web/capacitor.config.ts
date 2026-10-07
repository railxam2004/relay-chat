import type { CapacitorConfig } from '@capacitor/cli';

const config:CapacitorConfig={
  appId:'dev.relay.chat',appName:'Relay Chat',webDir:'dist',
  // A classroom VM may only have an HTTP IP address. Switch to false for a public release.
  server:{androidScheme:'http',cleartext:true},
  android:{backgroundColor:'#13243c'},ios:{contentInset:'never',backgroundColor:'#13243c'},
};
export default config;
