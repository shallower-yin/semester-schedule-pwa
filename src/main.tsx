import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { FocusAudioProvider } from "./components/FocusAudioProvider";
import { initializeDatabase } from "./db";
import { initializeNativeAppBridge } from "./lib/nativeApp";
import "./styles.css";

async function startApp() {
  await initializeDatabase();
  await initializeNativeAppBridge();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <FocusAudioProvider>
        <App />
      </FocusAudioProvider>
    </React.StrictMode>
  );
}

void startApp();
