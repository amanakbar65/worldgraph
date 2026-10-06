import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "maplibre-gl/dist/maplibre-gl.css";
import "@xyflow/react/dist/style.css";
import "./styles/globals.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { Providers } from "./app/Providers";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
);
