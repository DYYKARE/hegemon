import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

// Uygulamayı kapatır: Android'de gerçek çıkış (window.close WebView'de çalışmaz),
// tarayıcıda sekme kapatma denenir (script açmadıysa tarayıcı reddedebilir).
export function exitApplication() {
  if (Capacitor.isNativePlatform()) {
    CapacitorApp.exitApp();
  } else {
    window.close();
  }
}
