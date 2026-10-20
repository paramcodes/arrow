import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@arrow/ui/ui.css";
import "./app.css";

import { App } from "./App";

const container = document.querySelector<HTMLDivElement>("#root");

if (!container) {
  throw new Error("index.html is missing the #root container");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
