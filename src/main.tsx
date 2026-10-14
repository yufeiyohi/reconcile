import { createRoot } from "react-dom/client";
import App from "./App";
import { AccountApp } from "./components/AccountApp";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  import.meta.env.VITE_APP_MODE === "local" ? <App /> : <AccountApp />,
);
