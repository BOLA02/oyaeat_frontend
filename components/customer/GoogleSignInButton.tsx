"use client";

import Script from "next/script";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type: "standard";
              theme: "outline";
              size: "large";
              text: "continue_with";
              shape: "pill";
              width: number;
            },
          ) => void;
        };
      };
    };
  }
}

type Props = {
  disabled?: boolean;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
};

const GOOGLE_SCRIPT_ID = "google-identity-services";

/** Renders Google's own branded Identity Services button; it is not a custom OAuth UI. */
export default function GoogleSignInButton({ disabled = false, onCredential, onError }: Props) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const buttonRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);

  useEffect(() => {
    if (!clientId || !scriptReady || !buttonRef.current || !window.google) return;

    const render = () => {
      const container = buttonRef.current;
      if (!container || !window.google) return;
      const width = Math.max(200, Math.floor(container.getBoundingClientRect().width));
      window.google.accounts.id.initialize({
        client_id: clientId,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: ({ credential }) => {
          if (!credential) {
            onError("Google sign-in was not completed. Please try again.");
            return;
          }
          onCredential(credential);
        },
      });
      window.google.accounts.id.renderButton(container, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width,
      });
    };

    render();
    const observer = new ResizeObserver(render);
    observer.observe(buttonRef.current);
    return () => observer.disconnect();
  }, [clientId, onCredential, onError, scriptReady]);

  if (!clientId) {
    return (
      <p role="alert" className="rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm font-semibold text-warning">
        Google sign-in is temporarily unavailable. Please use email and password.
      </p>
    );
  }

  return (
    <>
      <Script
        id={GOOGLE_SCRIPT_ID}
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => onError("Google sign-in could not be loaded. Check your connection and try again.")}
      />
      <div className="relative flex h-12 w-full items-center justify-center overflow-hidden rounded-full">
        <div
          ref={buttonRef}
          aria-busy={disabled}
          className={disabled ? "pointer-events-none w-full opacity-60" : "w-full"}
        />
        {disabled && (
          <span className="absolute inset-0 grid place-items-center bg-card/60" aria-label="Signing in with Google">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </span>
        )}
      </div>
    </>
  );
}
