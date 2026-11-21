"use client";
import type { KeyboardEvent } from "react";

export function onChatKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
  // Touch keyboards own Return, including beforeinput-only and IME editing.
  if (
    event.key !== "Enter" ||
    window.matchMedia("(pointer: coarse)").matches ||
    event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.nativeEvent.isComposing ||
    event.nativeEvent.keyCode === 229
  )
    return;
  event.preventDefault();
  if (!event.repeat) {
    event.currentTarget.form
      ?.querySelector<HTMLButtonElement>("[data-primary-send]")
      ?.click();
  }
}
