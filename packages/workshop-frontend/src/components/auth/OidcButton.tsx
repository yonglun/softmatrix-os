import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RpcStub } from "capnweb";
import { Button, Banner } from "@cloudflare/kumo";
import type { OidcPublicConfig, OidcLoginResult, PublicApi } from "@gadgets/workshop-shared/api";

interface OidcButtonProps {
  rpcStub: RpcStub<PublicApi>;
  config: OidcPublicConfig;
  onSuccess?: () => void;
}

/** Enterprise OIDC sign-in button with popup cancellation and capability cleanup. */
export default function OidcButton({ rpcStub, config, onSuccess }: OidcButtonProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pollRef = useRef<number | null>(null);
  const attemptRef = useRef<Disposable | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (attemptRef.current) {
        try { attemptRef.current[Symbol.dispose](); } catch { /* already settled */ }
        attemptRef.current = null;
      }
    };
  }, []);

  const start = async () => {
    if (pending) return;
    setError(null);
    setPending(true);
    // Open a blank window synchronously from the click handler. Browsers block pop-ups opened
    // after the asynchronous startOidcLogin() RPC resolves because the user gesture has ended.
    // Navigating this already-authorized window keeps enterprise SSO usable in real browsers.
    const popup = window.open("about:blank", "oidc-login", "popup,width=520,height=680");
    if (!popup) {
      setError(t("auth.popupBlocked"));
      setPending(false);
      return;
    }
    try {
      const { url, attempt } = await rpcStub.startOidcLogin();
      attemptRef.current = attempt as unknown as Disposable;
      popup.location.href = url;

      const result = await new Promise<OidcLoginResult>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          if (pollRef.current !== null) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          try { (attempt as unknown as Disposable)[Symbol.dispose](); } catch { /* already settled */ }
          attemptRef.current = null;
          fn();
        };
        pollRef.current = window.setInterval(() => {
          if (popup.closed) finish(() => reject(new Error(t("auth.signInCancelled"))));
        }, 500);
        attempt.wait().then(value => finish(() => resolve(value))).catch(reason =>
          finish(() => reject(reason instanceof Error ? reason : new Error(t("auth.signInFailed")))),
        );
      });

      if (!mountedRef.current) return;
      if (!result.ok) {
        setError(t(`errors.${result.error.code}`, { correlationId: result.error.correlationId }));
        return;
      }
      localStorage.setItem("authToken", result.token);
      if (onSuccess) onSuccess();
      else window.location.reload();
    } catch (reason) {
      if (!popup.closed) popup.close();
      if (mountedRef.current) {
        const popupBlocked = t("auth.popupBlocked");
        const signInCancelled = t("auth.signInCancelled");
        setError(reason instanceof Error && (reason.message === popupBlocked || reason.message === signInCancelled)
          ? reason.message
          : t("auth.signInFailed"));
      }
    } finally {
      if (mountedRef.current) setPending(false);
    }
  };

  return (
    <div className="space-y-3">
      {error && <Banner variant="error" title={error} role="alert" />}
      <Button
        variant="secondary"
        onClick={start}
        loading={pending}
        disabled={pending}
        className="w-full justify-center"
      >
        {t("auth.continueWithProvider", { provider: config.displayName })}
      </Button>
    </div>
  );
}
