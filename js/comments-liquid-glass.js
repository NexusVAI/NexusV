import React from "react"
import { createRoot } from "react-dom/client"
import LiquidGlass from "./vendor/liquid-glass-react.esm.js"

const mount = document.getElementById("comments-liquid-glass-root")

if (mount) {
  const root = createRoot(mount)
  const toggleComments = () => {
    const commentsOverlay = document.getElementById("comments-overlay")
    if (!commentsOverlay) {
      return
    }
    const isShowing = commentsOverlay.classList.contains("show")
    if (isShowing) {
      if (window.closeCommentsModal) {
        window.closeCommentsModal()
      }
    } else if (window.openCommentsModal) {
      window.openCommentsModal()
    }
  }

  const buttonNode = React.createElement(
    "button",
    {
      id: "comments-toggle-btn",
      type: "button",
      className: "comments-toggle-btn-core",
      onClick: toggleComments,
    },
    React.createElement(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        width: "18",
        height: "18",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
      },
      React.createElement("path", { d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" }),
    ),
    React.createElement("span", { className: "toggle-text" }, "留言 NexusV"),
  )

  root.render(
    React.createElement(
      LiquidGlass,
      {
        displacementScale: 70,
        blurAmount: 0,
        saturation: 140,
        aberrationIntensity: 2,
        elasticity: 0.15,
        cornerRadius: 999,
        padding: "12px 20px",
        mode: "standard",
        onClick: toggleComments,
        style: {
          position: "fixed",
          top: "calc(100% - 58px)",
          left: "50%",
          zIndex: 9999,
        },
      },
      buttonNode,
    ),
  )
}
