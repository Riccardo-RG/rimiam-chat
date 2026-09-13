"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
export default function LocalMail() {
  const [items, setItems] = useState<
    { recipient: string; subject: string; link: string }[]
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch("/api/local-mail")
      .then(async (r) => {
        if (!r.ok)
          throw new Error("Casella disponibile solo nello sviluppo locale.");
        setItems(await r.json());
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <main className="welcome">
      <h1>Casella locale</h1>
      <p>
        Solo sviluppo su questo computer. Le email non vengono inviate a
        destinatari esterni.
      </p>
      {error && <p role="alert">{error}</p>}
      {items.map((m, i) => (
        <article className="card" key={i}>
          <h2>{m.recipient}</h2>
          <a href={m.link}>{m.subject}</a>
        </article>
      ))}
      <Link href="/">Torna a Miriam</Link>
    </main>
  );
}
