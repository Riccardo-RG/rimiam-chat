import { useUiLanguage } from "../i18n";
import React, { useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import type { File } from "expo-file-system";
import { newSketchFile } from "./sketch-files";

import {
  sketchInks,
  sketchPage,
  sketchPoint,
  strokePath,
  type SketchStroke,
} from "../../../src/shared/chat-sketch";
import { Action, usePalette } from "../ui";
import { captureAttachment, type Attachment } from "./commands";
import { Panel } from "./SharedFiles";

export function SketchPanel({
  onClose,
  onAttach,
}: {
  onClose: () => void;
  onAttach: (file: Attachment) => void | boolean | Promise<boolean | void>;
}) {
  const { t: uiText } = useUiLanguage();
  const c = usePalette(),
    { width, height } = useWindowDimensions();
  const [sheet, setSheet] = useState<SketchStroke[]>([]);
  const [ink, chooseInk] = useState<string>(sketchInks.Grafite);
  const [issue, setIssue] = useState("");
  const [saving, setSaving] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const busy = useRef(false),
    active = useRef(false),
    svg = useRef<Svg>(null);
  const [available, setAvailable] = useState(0);
  const w = Math.max(
      1,
      Math.min(
        available,
        width - 32,
        Math.max(120, ((height - 182) * sketchPage.width) / sketchPage.height),
      ),
    ),
    h = (w * sketchPage.height) / sketchPage.width;
  const point = (e: GestureResponderEvent) =>
    sketchPoint(e.nativeEvent.locationX, e.nativeEvent.locationY, w, h);
  async function attach() {
    if (busy.current || !sheet.length || !svg.current) return;
    busy.current = true;
    setSaving(true);
    setIssue("");
    let file: File | undefined;
    try {
      const view = svg.current;
      const png = await new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(new Error(uiText("Esportazione non riuscita. Riprova."))),
          8000,
        );
        view.toDataURL(
          (data) => {
            clearTimeout(timeout);
            resolve(data);
          },
          { width: sketchPage.width, height: sketchPage.height },
        );
      });
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      if (
        bytes[0] !== 137 ||
        bytes[1] !== 80 ||
        bytes[2] !== 78 ||
        bytes[3] !== 71
      )
        throw new Error(uiText("Impossibile preparare il PNG."));
      file = newSketchFile();
      file.write(bytes);
      if (
        (await onAttach(
          await captureAttachment(file.uri, uiText("Schizzo.png")),
        )) === false
      )
        throw new Error(uiText("Rimuovi un allegato dalla bozza e riprova."));
      file = undefined;
      onClose();
    } catch (e) {
      setIssue(
        e instanceof Error
          ? e.message
          : uiText("Non riesco ad allegare il disegno."),
      );
    } finally {
      if (file?.exists) file.delete();
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <Panel
      title={uiText("Disegna")}
      onClose={() => {
        if (!busy.current) onClose();
      }}
    >
      <ScrollView
        scrollEnabled={!drawing}
        contentContainerStyle={{ gap: 9, paddingHorizontal: 4 }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          {Object.entries(sketchInks).map(([name, color]) => (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityLabel={uiText("Penna {0}", uiText(name))}
              accessibilityState={{ selected: ink === color }}
              disabled={saving}
              onPress={() => chooseInk(color)}
              style={{
                width: 48,
                height: 48,
                alignItems: "center",
                justifyContent: "center",
                borderBottomWidth: ink === color ? 2 : 0,
                borderColor: c.accent,
              }}
            >
              <View
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: color,
                  borderWidth: 1,
                  borderColor: c.controlLine,
                }}
              />
            </Pressable>
          ))}
          <Action
            variant="quiet"
            label={uiText("Annulla tratto")}
            disabled={!sheet.length || saving}
            onPress={() => setSheet((s) => s.slice(0, -1))}
          />
        </View>
        <View
          onLayout={(e) => setAvailable(e.nativeEvent.layout.width)}
          style={{ alignItems: "center" }}
        >
          <View
            accessible
            accessibilityLabel={uiText("Tela di disegno")}
            onStartShouldSetResponder={() => !saving}
            onResponderGrant={(e) => {
              const p = point(e);
              active.current = true;
              setDrawing(true);
              setSheet((s) => [...s, { ink, points: [p] }]);
            }}
            onResponderTerminationRequest={() => false}
            onResponderMove={(e) => {
              if (!active.current) return;
              const p = point(e);
              setSheet((s) => {
                const last = s[s.length - 1];
                if (!last) return s;
                const prev = last.points[last.points.length - 1];
                if (prev.x === p.x && prev.y === p.y) return s;
                return [
                  ...s.slice(0, -1),
                  { ...last, points: [...last.points, p] },
                ];
              });
            }}
            onResponderRelease={() => {
              active.current = false;
              setDrawing(false);
            }}
            onResponderTerminate={() => {
              active.current = false;
              setDrawing(false);
            }}
            style={{ width: w, height: h, backgroundColor: "#fff" }}
          >
            <View pointerEvents="none">
              <Svg
                ref={svg}
                width={w}
                height={h}
                viewBox={"0 0 " + sketchPage.width + " " + sketchPage.height}
              >
                <Rect
                  width={sketchPage.width}
                  height={sketchPage.height}
                  fill="#fff"
                />
                {sheet.map((s, i) => (
                  <Path
                    key={i}
                    d={strokePath(s.points)}
                    fill="none"
                    stroke={s.ink}
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </Svg>
            </View>
          </View>
        </View>
        {!!issue && (
          <Text accessibilityRole="alert" style={{ color: c.danger }}>
            {issue}
          </Text>
        )}
        <Action
          label={
            saving ? uiText("Preparazione…") : uiText("Aggiungi al messaggio")
          }
          icon="attach"
          primary
          disabled={saving || !sheet.length}
          onPress={() => void attach()}
        />
      </ScrollView>
    </Panel>
  );
}
