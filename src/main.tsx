import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource-variable/geist-mono/index.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import LandedWindow from "./components/landed/LandedWindow";
import "./index.css";

document.documentElement.dataset.theme = "dark";

// The notch panel is its own light window: skip App's main-window init.
const isLanded = "__TAURI_INTERNALS__" in window && getCurrentWebviewWindow().label === "landed";
if (isLanded) {
  document.documentElement.dataset.window = "landed";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isLanded ? <LandedWindow /> : <App />}</StrictMode>,
);
