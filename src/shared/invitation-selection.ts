import { z } from "zod";
import {
  MAX_WORKSPACE_INVITE_RECIPIENTS,
  type WorkspaceInviteRecipient,
} from "../contracts/workspace-invitations";

export interface SelectedRecipient {
  label: string;
  target: WorkspaceInviteRecipient;
}

export function recipientKey({ target }: SelectedRecipient) {
  return "contactId" in target
    ? `contact:${target.contactId}`
    : `email:${target.email}`;
}

export function invitationSelection(
  selected: SelectedRecipient[],
  text: string,
) {
  const email = z.email().safeParse(text.trim().toLowerCase());
  if (
    !email.success ||
    selected.length >= MAX_WORKSPACE_INVITE_RECIPIENTS ||
    selected.some(
      ({ target }) => "email" in target && target.email === email.data,
    )
  )
    return selected;
  return [...selected, { label: email.data, target: { email: email.data } }];
}
