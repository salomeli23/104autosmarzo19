import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";

// La rueda del mouse no cambia los campos numéricos (precios, valores): al girarla sobre el campo
// enfocado se quita el foco, el valor queda igual y la página sigue bajando normalmente.
document.addEventListener("wheel", (e) => {
  const el = document.activeElement;
  if (el && el.type === "number" && el === e.target) el.blur();
}, { passive: true });

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
