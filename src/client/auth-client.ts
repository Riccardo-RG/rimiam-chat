"use client";
import { createAuthClient } from "better-auth/react";

// All account forms and the Workspace observe the same session-change signal.
export const auth = createAuthClient();
