import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeDatabase } from "./db";
import "./styles.css";

async function startApp() {
  await initializeDatabase();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void startApp();
