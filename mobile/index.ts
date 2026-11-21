import { registerRootComponent } from "expo";
import App from "./App";
import { privateMediaCache } from "./src/private-media-cache";
import { prepareCallPlayback } from "./src/calls/playback-files";

try {
  privateMediaCache();
  prepareCallPlayback();
} catch {
  // The authenticated player retries cleanup before it opens its first file.
}
registerRootComponent(App);
