/**
 * Development entry for the design preview: `npm run dev`, then open
 * /preview.html (add ?theme=light or ?calm=1 to start that way).
 * Not part of the production build.
 */
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/globals.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Providers } from "./app/Providers";
import DesignPreview from "./features/settings/DesignPreview";
import { useSettings } from "./state/settings";

const params = new URLSearchParams(window.location.search);
const theme = params.get("theme");
if (theme === "light" || theme === "dark") useSettings.setState({ theme });
if (params.get("calm") === "1") useSettings.setState({ calm: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers>
      <DesignPreview />
    </Providers>
  </StrictMode>,
);
