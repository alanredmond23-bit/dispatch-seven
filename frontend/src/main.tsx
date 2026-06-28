import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Apply stored theme immediately (avoids flash)
const theme = localStorage.getItem("theme") ?? "dark";
document.documentElement.classList.toggle("dark", theme === "dark");

// Kill ALL service workers — they cause blank-screen cache issues on iOS Safari
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => reg.unregister());
  });
}

// Simple error boundary
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: Error | null}> {
  constructor(props: {children: React.ReactNode}) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ background: "#050810", color: "#e2e8f0", fontFamily: "monospace", padding: "40px 20px", minHeight: "100vh" }}>
          <div style={{ color: "#dc2626", marginBottom: "16px", fontSize: "12px", letterSpacing: ".15em" }}>D7 — RUNTIME ERROR</div>
          <pre style={{ color: "#94a3b8", fontSize: "11px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack?.split("\n").slice(0, 5).join("\n")}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
