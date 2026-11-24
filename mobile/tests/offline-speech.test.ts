import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import type { Voice } from "@nammayatri/react-native-tts";
import { startOfflineSpeech } from "../src/workspace/offline-speech.ts";

const installed: Voice = {
  id: "device-it",
  name: "Italiano",
  language: "it-IT",
  quality: 200,
  networkConnectionRequired: false,
  notInstalled: false,
};

function device(voices: Voice[] = [installed]) {
  const listeners = new Map<string, (event: { utteranceId: string }) => void>();
  const selected: string[] = [];
  const spoken: string[] = [];
  let stopped = 0;
  const engine = {
    getInitStatus: async () => "success",
    voices: async () => voices,
    setDefaultVoice: async (id: string) => {
      selected.push(id);
      return "success";
    },
    speak: async (text: string) => String(spoken.push(text)),
    stop: async () => {
      stopped++;
      return true;
    },
    addEventListener(
      event: string,
      handler: (event: { utteranceId: string }) => void,
    ) {
      listeners.set(event, handler);
      return { remove: () => listeners.delete(event) };
    },
  };
  return {
    engine,
    selected,
    spoken,
    get stopped() {
      return stopped;
    },
    get listeners() {
      return listeners.size;
    },
    emit: (type: string, id: string) =>
      listeners.get(type)?.({ utteranceId: id }),
  };
}

test("only explicitly installed offline voices in the requested language may receive text", async () => {
  const unsafe = [
    { ...installed, networkConnectionRequired: true },
    { ...installed, notInstalled: true },
    { ...installed, notInstalled: undefined },
    { ...installed, networkConnectionRequired: undefined },
    { ...installed, language: "fr-FR" },
  ];
  const d = device(unsafe);
  await assert.rejects(
    startOfflineSpeech(d.engine, "privato", "it-IT").done,
    /Installa una voce locale/,
  );
  assert.deepEqual(d.selected, []);
  assert.deepEqual(d.spoken, []);
  const denied = device();
  denied.engine.setDefaultVoice = async () => {
    throw new Error("voice removed");
  };
  await assert.rejects(
    startOfflineSpeech(denied.engine, "privato", "it-IT").done,
  );
  assert.deepEqual(denied.spoken, []);
});

test("selects the best exact locale, reads long text in order, and accepts early completion events", async () => {
  const d = device([
    { ...installed, id: "elsewhere", language: "it-CH", quality: 500 },
    installed,
    { ...installed, id: "better", quality: 300 },
  ]);
  const text = "a".repeat(3998) + "🌞" + "b".repeat(8000);
  const playback = startOfflineSpeech(d.engine, text, "IT-it");
  await setImmediate();
  assert.deepEqual(d.selected, ["better"]);
  assert.equal(d.spoken.length, 1);
  d.emit("tts-finish", "an old playback");
  assert.equal(d.spoken.length, 1);
  const speak = d.engine.speak;
  d.engine.speak = async (part: string) => {
    const id = await speak(part);
    d.emit("tts-finish", id);
    return id;
  };
  d.emit("tts-finish", "1");
  await playback.done;
  assert.equal(d.spoken.join(""), text);
  assert.ok(
    d.spoken.every((part) => part.length < 4000 && part.isWellFormed()),
  );
  assert.equal(d.listeners, 0);
});

test("a cancelled preparation cannot start reading or later stop a newer message", async () => {
  const d = device();
  let ready!: (status: string) => void;
  d.engine.getInitStatus = () =>
    new Promise((resolve) => {
      ready = resolve;
    });
  const old = startOfflineSpeech(d.engine, "primo", "it-IT");
  d.engine.getInitStatus = async () => "success";
  const current = startOfflineSpeech(d.engine, "secondo", "it-IT");
  await old.done;
  ready("success");
  old.stop();
  await setImmediate();
  assert.deepEqual(d.spoken, ["secondo"]);
  assert.equal(d.stopped, 1);
  current.stop();
  await current.done;
  assert.equal(d.stopped, 2);
  assert.equal(d.listeners, 0);
});

test("a playback error stops the engine before reading the following chunk", async () => {
  const d = device();
  const playback = startOfflineSpeech(d.engine, "a".repeat(6000), "it-IT");
  await setImmediate();
  d.emit("tts-error", "1");
  await assert.rejects(playback.done, /interrotta/);
  assert.equal(d.spoken.length, 1);
  assert.equal(d.stopped, 1);
  assert.equal(d.listeners, 0);
});
