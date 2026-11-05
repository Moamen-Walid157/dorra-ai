"use client";

import { useEffect, useState } from "react";
import Studio from "@/components/studio";
import { clearKey, isUnlocked, lockStudio, readKey, saveKey, unlock } from "@/lib/access";

export default function Room() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    setOpen(isUnlocked());
    setApiKey(readKey());
    setReady(true);
  }, []);

  if (!ready) return <main className="gate" />;
  if (!open) {
    return (
      <Password
        onUnlock={() => {
          setOpen(true);
          setApiKey(readKey());
        }}
      />
    );
  }
  if (!apiKey) {
    return (
      <KeyForm
        onSave={(value) => {
          saveKey(value);
          setApiKey(value.trim());
        }}
      />
    );
  }

  return (
    <Studio
      apiKey={apiKey}
      onLock={() => {
        lockStudio();
        setOpen(false);
      }}
      onReplaceKey={() => {
        clearKey();
        setApiKey("");
      }}
    />
  );
}

function Password({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  return (
    <main className="gate">
      <form
        className="gate-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!unlock(password)) {
            setError("That password does not open the room.");
            return;
          }
          onUnlock();
        }}
      >
        <p className="brand-kicker">Private screening room</p>
        <h1>Dorra</h1>
        <p className="fine">Enter the studio password to continue.</p>
        <label htmlFor="studio-password">Password</label>
        <input
          id="studio-password"
          type="password"
          autoFocus
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && <p className="alert">{error}</p>}
        <button className="primary" type="submit">
          Enter
        </button>
      </form>
    </main>
  );
}

function KeyForm({ onSave }: { onSave: (value: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <main className="gate">
      <form
        className="gate-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim().length < 10) return;
          onSave(value);
        }}
      >
        <p className="brand-kicker">Moamen api</p>
        <h1>Google key</h1>
        <p className="fine">
          Paste the key once. It stays in this browser only, so the Netlify files do not contain it.
        </p>
        <label htmlFor="gemini-key">API key</label>
        <input
          id="gemini-key"
          type="password"
          autoFocus
          value={value}
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
        />
        <button className="primary" type="submit" disabled={value.trim().length < 10}>
          Save key
        </button>
      </form>
    </main>
  );
}
