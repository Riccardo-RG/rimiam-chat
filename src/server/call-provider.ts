import {
  AccessToken,
  EgressClient,
  EncodedFileOutput,
  EncodedFileType,
  RoomServiceClient,
  S3Upload,
  TrackSource,
} from "livekit-server-sdk";
import { DomainError, requireThat } from "./errors.ts";

export interface CallTransport {
  connect(
    room: string,
    identity: string,
  ): Promise<{ url: string; token: string }>;
  participants(room: string): Promise<{ identity: string; tracks: string[] }[]>;
  remove(room: string, identity: string): Promise<void>;
  recordings(room: string): Promise<
    {
      id: string;
      key: string;
      state: "active" | "stopping" | "complete" | "failed";
    }[]
  >;
  start(room: string, track: string, key: string): Promise<string>;
  stop(id: string): Promise<void>;
}
export function callConfigured() {
  return !!(
    process.env.LIVEKIT_URL &&
    process.env.LIVEKIT_API_KEY &&
    process.env.LIVEKIT_API_SECRET
  );
}
export function recordingConfigured() {
  return (
    callConfigured() &&
    !!(
      process.env.CALL_STORAGE_BUCKET &&
      process.env.CALL_STORAGE_ACCESS_KEY &&
      process.env.CALL_STORAGE_SECRET_KEY &&
      process.env.CALL_STORAGE_REGION
    )
  );
}
export function callTransport(): CallTransport {
  requireThat(callConfigured(), "CALL_CONFIGURATION_REQUIRED", 503);
  const url = new URL(process.env.LIVEKIT_URL!);
  // Cloud revokes issued tokens on removeParticipant. Self-hosted LiveKit does not
  // provide the same revocation guarantee and is not interchangeable at this boundary.
  requireThat(
    url.protocol === "wss:" && url.hostname.endsWith(".livekit.cloud"),
    "CALL_CLOUD_CONFIGURATION_REQUIRED",
    503,
  );
  const key = process.env.LIVEKIT_API_KEY!,
    secret = process.env.LIVEKIT_API_SECRET!;
  const host = url.href.replace(/^wss:/, "https:");
  const rooms = new RoomServiceClient(host, key, secret, {
      requestTimeout: 10,
      failover: false,
    }),
    egress = new EgressClient(host, key, secret, {
      requestTimeout: 10,
      failover: false,
    });
  return {
    async connect(room, identity) {
      const token = new AccessToken(key, secret, { identity, ttl: 60 });
      token.addGrant({
        room,
        roomJoin: true,
        canSubscribe: true,
        canPublish: true,
        canPublishSources: [TrackSource.MICROPHONE],
        canPublishData: false,
        canUpdateOwnMetadata: false,
      });
      return { url: url.href, token: await token.toJwt() };
    },
    async participants(room) {
      try {
        return (await rooms.listParticipants(room))
          .filter((p) => p.permission?.canPublish)
          .map((p) => ({
            identity: p.identity,
            tracks: p.tracks
              .filter((t) => t.source === TrackSource.MICROPHONE)
              .map((t) => t.sid),
          }));
      } catch (e) {
        if ((e as { code?: string }).code === "not_found") return [];
        throw e;
      }
    },
    async remove(room, identity) {
      try {
        await rooms.removeParticipant(room, identity);
      } catch (e) {
        if ((e as { code?: string }).code !== "not_found") throw e;
      }
    },
    async recordings(room) {
      return (await egress.listEgress({ roomName: room })).map((e) => ({
        id: e.egressId,
        key:
          e.request.case === "trackComposite"
            ? (e.request.value.fileOutputs[0]?.filepath ?? "")
            : (e.fileResults[0]?.filename ?? ""),
        state:
          e.status < 2
            ? "active"
            : e.status === 2
              ? "stopping"
              : e.status === 3 || e.status === 6
                ? "complete"
                : "failed",
      }));
    },
    async start(room, track, objectKey) {
      requireThat(
        recordingConfigured(),
        "CALL_RECORDING_CONFIGURATION_REQUIRED",
        503,
      );
      const output = new EncodedFileOutput({
        fileType: EncodedFileType.MP3,
        filepath: objectKey,
        disableManifest: true,
        output: {
          case: "s3",
          value: new S3Upload({
            bucket: process.env.CALL_STORAGE_BUCKET!,
            region: process.env.CALL_STORAGE_REGION!,
            accessKey: process.env.CALL_STORAGE_ACCESS_KEY!,
            secret: process.env.CALL_STORAGE_SECRET_KEY!,
            endpoint: process.env.CALL_STORAGE_ENDPOINT ?? "",
            forcePathStyle: process.env.CALL_STORAGE_PATH_STYLE === "true",
          }),
        },
      });
      const started = await egress.startTrackCompositeEgress(room, output, {
        audioTrackId: track,
      });
      if (!started.egressId)
        throw new DomainError("CALL_RECORDING_OUTCOME_UNKNOWN", 503);
      return started.egressId;
    },
    async stop(id) {
      await egress.stopEgress(id);
    },
  };
}
