import { registerPlugin } from "@capacitor/core";

export interface NativeAppVersion {
  versionName: string;
  versionCode: number;
}

export interface AppUpdaterPlugin {
  getNativeVersion(): Promise<NativeAppVersion>;
  canRequestPackageInstalls(): Promise<{ granted: boolean }>;
  requestPackageInstallPermission(): Promise<{ granted: boolean }>;
  downloadAndInstall(options: { url: string; sha256?: string }): Promise<{ started: boolean }>;
}

export const AppUpdater = registerPlugin<AppUpdaterPlugin>("AppUpdater");
