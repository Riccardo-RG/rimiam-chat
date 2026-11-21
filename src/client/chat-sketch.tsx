"use client";
import { useUiLanguage } from "./ui-language";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  sketchPage,
  sketchInks,
  sketchPoint,
  strokePath,
  type SketchStroke,
} from "../shared/chat-sketch";
import css from "./chat-sketch.module.css";

export function ChatSketch({
  onAttach,
  onClose,
}: {
  onAttach: (file: File) => boolean;
  onClose: () => void;
}) {
  const { t: uiText } = useUiLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const pointer = useRef<number | null>(null);
  const [strokes, setStrokes] = useState<SketchStroke[]>([]);
  const [ink, setInk] = useState<string>(sketchInks.Grafite);
  const [issue, setIssue] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  function position(e: PointerEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    return sketchPoint(
      e.clientX - box.left,
      e.clientY - box.top,
      box.width,
      box.height,
    );
  }
  async function attach() {
    if (saving || !strokes.length) return;
    setSaving(true);
    setIssue("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = sketchPage.width;
      canvas.height = sketchPage.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error();
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 4;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const stroke of strokes) {
        ctx.strokeStyle = stroke.ink;
        ctx.stroke(new Path2D(strokePath(stroke.points)));
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (!dialog.current?.open) return;
      if (!blob) throw new Error();
      if (
        onAttach(new File([blob], uiText("Schizzo.png"), { type: "image/png" }))
      )
        onClose();
      else
        setIssue(
          uiText(
            "Impossibile aggiungere il disegno. Controlla lo spazio disponibile nella bozza.",
          ),
        );
    } catch {
      if (dialog.current?.open)
        setIssue(uiText("Esportazione non riuscita. Riprova."));
    } finally {
      setSaving(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className={css.dialog}
      aria-labelledby="sketch-heading"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header>
        <h2 id="sketch-heading">{uiText("Disegna")}</h2>
        <button type="button" className="quiet" onClick={onClose}>
          {uiText("Chiudi")}
        </button>
      </header>
      <div className={css.tools} role="group" aria-label={uiText("Penne")}>
        {Object.entries(sketchInks).map(([name, color]) => (
          <button
            type="button"
            key={name}
            aria-label={uiText("Penna {0}", uiText(name))}
            title={uiText(name)}
            aria-pressed={ink === color}
            onClick={() => setInk(color)}
          >
            <i style={{ background: color }} />
          </button>
        ))}
        <button
          type="button"
          className="quiet"
          disabled={saving || !strokes.length}
          onClick={() => setStrokes((s) => s.slice(0, -1))}
        >
          {uiText("Annulla tratto")}
        </button>
      </div>
      <svg
        className={css.sheet}
        viewBox="0 0 640 440"
        role="img"
        aria-label={uiText("Tela di disegno")}
        onPointerDown={(e) => {
          if (saving || pointer.current !== null || e.button !== 0) return;
          const p = position(e);
          pointer.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          setStrokes((s) => [...s, { ink, points: [p] }]);
        }}
        onPointerMove={(e) => {
          if (pointer.current !== e.pointerId) return;
          const p = position(e);
          setStrokes((s) => {
            const last = s.at(-1);
            if (!last) return s;
            const prev = last.points.at(-1);
            if (prev?.x === p.x && prev.y === p.y) return s;
            return [
              ...s.slice(0, -1),
              { ...last, points: [...last.points, p] },
            ];
          });
        }}
        onLostPointerCapture={(e) => {
          if (pointer.current === e.pointerId) pointer.current = null;
        }}
      >
        {strokes.map((s, i) => (
          <path
            key={i}
            d={strokePath(s.points)}
            fill="none"
            stroke={s.ink}
            strokeWidth="4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
      </svg>
      {issue && <p role="alert">{issue}</p>}
      <footer>
        <button
          type="button"
          disabled={!strokes.length || saving}
          onClick={() => void attach()}
        >
          {uiText("Aggiungi al messaggio")}
        </button>
      </footer>
    </dialog>
  );
}
