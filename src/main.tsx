import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/outfit/500.css";
import "./styles.css";
import App from "./App";

// In a plain browser during `pnpm dev`, fake the Tauri backend.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  await (await import("./devMock")).installDevMock();
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
