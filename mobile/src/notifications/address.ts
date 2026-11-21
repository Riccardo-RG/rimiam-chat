const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function notificationAddress(
  data: Record<string, unknown> | null | undefined,
  legacyPushPayload?: Record<string, unknown>,
) {
  // Older APNs alerts can still be in the notification center after an update.
  const address = data ?? legacyPushPayload;
  const id = address?.id,
    deviceId = address?.deviceId;
  return typeof id === "string" &&
    uuid.test(id) &&
    typeof deviceId === "string" &&
    uuid.test(deviceId)
    ? { id, deviceId }
    : null;
}
