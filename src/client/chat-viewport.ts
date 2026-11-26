"use client";
import { useEffect, type RefObject } from "react";

export function useChatViewport(
  member: RefObject<HTMLElement | null>,
  enabled = true,
) {
  useEffect(() => {
    const viewport = window.visualViewport;
    const workspace = member.current?.closest("main");
    if (!enabled || !viewport || !workspace) return;
    // The rail and the Workspace share a grid. If only the Workspace shrinks,
    // Safari can still scroll the full-height page behind the software keyboard.
    const heightHost =
      workspace.closest<HTMLElement>(".app-shell") ?? workspace;
    // On iOS the keyboard can resize the visual viewport alone. Preserve pinch zoom.
    const updateWritingMode = () => {
      const focused = document.activeElement;
      const composerFocused = focused?.matches(".composer-field textarea");
      // Keep the control in place through the tap's blur/click sequence.
      const stillEditing =
        workspace.hasAttribute("data-short-composer") &&
        (focused === document.body || !!focused?.closest(".composer-dock"));
      const shortComposer =
        viewport.scale === 1 &&
        viewport.height < 190 &&
        (!!composerFocused || stillEditing);
      workspace.toggleAttribute("data-short-composer", shortComposer);
      // The expanded Safari tab bar and keyboard can leave only one 44px row.
      workspace.toggleAttribute(
        "data-single-line-composer",
        shortComposer && viewport.height < 100,
      );
    };
    const touch = window.matchMedia("(pointer: coarse)");
    const positionChat = () => {
      // Safari can pan the document to the old textarea position after opening
      // its keyboard, even once both grid and composer fit the visual viewport.
      // Only follow that pan while writing at natural zoom in the isolated chat.
      const active = document.activeElement;
      const surface = workspace.querySelector(
        "[data-compose-surface][data-editing]",
      );
      // A touch can temporarily move focus to the page before click. Resetting
      // the pan in that interval moves every button away from the finger.
      const writing =
        active?.matches("[data-compose-surface] textarea") ||
        (surface && (active === document.body || surface.contains(active)));
      workspace.style.setProperty(
        "--chat-viewport-offset",
        viewport.offsetTop + "px",
      );
      const top =
        touch.matches && writing && viewport.scale === 1
          ? Math.max(0, viewport.pageTop)
          : 0;
      if (top) workspace.style.setProperty("--chat-keyboard-pan", top + "px");
      else workspace.style.removeProperty("--chat-keyboard-pan");
      workspace.toggleAttribute("data-keyboard-pan", top > 0);
    };
    const fitKeyboard = () => {
      workspace.toggleAttribute(
        "data-keyboard-open",
        touch.matches &&
          viewport.scale === 1 &&
          window.innerHeight - viewport.height > 100,
      );
      workspace.toggleAttribute(
        "data-low-viewport",
        viewport.scale === 1 && viewport.height <= 320,
      );
      updateWritingMode();
      positionChat();
      if (viewport.scale === 1) {
        heightHost.style.setProperty(
          "--chat-viewport-height",
          viewport.height + "px",
        );
      } else {
        heightHost.style.removeProperty("--chat-viewport-height");
      }
    };
    fitKeyboard();
    viewport.addEventListener("resize", fitKeyboard);
    viewport.addEventListener("scroll", positionChat);
    window.addEventListener("scroll", positionChat);
    workspace.addEventListener("focusin", positionChat);
    workspace.addEventListener("focusin", updateWritingMode);
    return () => {
      viewport.removeEventListener("resize", fitKeyboard);
      viewport.removeEventListener("scroll", positionChat);
      window.removeEventListener("scroll", positionChat);
      workspace.removeEventListener("focusin", positionChat);
      workspace.removeAttribute("data-low-viewport");
      workspace.removeAttribute("data-keyboard-open");
      workspace.style.removeProperty("--chat-viewport-offset");
      workspace.removeAttribute("data-keyboard-pan");
      workspace.style.removeProperty("--chat-keyboard-pan");
      workspace.removeEventListener("focusin", updateWritingMode);
      workspace.removeAttribute("data-short-composer");
      workspace.removeAttribute("data-single-line-composer");
      heightHost.style.removeProperty("--chat-viewport-height");
    };
  }, [member, enabled]);
}
