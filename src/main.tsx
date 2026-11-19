// src/main.tsx
console.log("[boot] main.tsx start", performance.now());

import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/main.css";
import { installSelectAllGuard } from "@/features/ui/lib/selectAllGuard";

installSelectAllGuard();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);