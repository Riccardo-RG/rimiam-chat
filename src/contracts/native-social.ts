import { z } from "zod";
export const nativeSocialState = z.string().regex(/^[a-f0-9]{64}$/);
export const nativeSocialChallenge = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const nativeSocialExchange = z
  .object({
    code: nativeSocialChallenge,
    verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
    state: nativeSocialState,
  })
  .strict();
export const nativeSocialOptions = z.object({
  google: z.boolean(),
  microsoft: z.boolean(),
});

export const nativeLinkedMethods = z.object({
  google: z.object({ available: z.boolean(), linked: z.boolean() }),
  microsoft: z.object({ available: z.boolean(), linked: z.boolean() }),
});
export type NativeLinkedMethods = z.infer<typeof nativeLinkedMethods>;
