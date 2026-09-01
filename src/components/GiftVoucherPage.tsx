// Gift vouchers. Purchase only — redemption happens through the promotion
// code field the print checkout already has, so there is no second checkout to
// maintain. The buyer is handed to Stripe's hosted page; the webhook mints the
// coupon and emails the code.
import { ArrowLeft, Check, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { money } from "../lib/printCatalogue";
import { usePublicContent } from "../lib/publicContent";
import { useSeo } from "../lib/seo";
import { supabase } from "../lib/supabase";
import { ShopLegalFooter } from "./LegalPages";

const AMOUNTS = [10000, 20000, 40000];

export function GiftVoucherPage({ onNavigate }: { onNavigate: (route: string) => void }) {
  const content = usePublicContent();
  useSeo(`Gift vouchers — ${content.siteName}`, {
    description: "Give a framed fine-art print. Gift vouchers are emailed as a single-use code, redeemable against any print in the shop.",
    path: "/shop/gift-voucher",
  });
  const purchased = new URLSearchParams(window.location.search).get("purchase") === "success";
  const [amountCents, setAmountCents] = useState(AMOUNTS[0]);
  const [recipientName, setRecipientName] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [message, setMessage] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  function go(path: string) {
    window.history.pushState({}, "", path);
    onNavigate(path);
  }

  async function buy(event: React.FormEvent) {
    event.preventDefault();
    setStarting(true);
    setError("");
    try {
      const accessToken = supabase ? (await supabase.auth.getSession()).data.session?.access_token : null;
      const response = await fetch("/api/create-voucher-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ amountCents, recipientName, buyerName, buyerEmail, message }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "The voucher could not be started.");
      if (!data?.url) throw new Error("Stripe did not return a secure checkout page.");
      window.location.assign(data.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The voucher could not be started.");
      setStarting(false);
    }
  }

  return (
    <main className="gift-voucher-page">
      <nav className="legal-page__top" aria-label="Shop navigation">
        <a href="/shop" onClick={(event) => { event.preventDefault(); go("/shop"); }}><ArrowLeft size={14} aria-hidden="true" /> Back to Framed Editions</a>
        <a href="/galleries" onClick={(event) => { event.preventDefault(); go("/galleries"); }}>Photography galleries →</a>
      </nav>
      <article className="gift-voucher">
        <p className="eyebrow">{content.siteName}</p>
        <h1>Gift vouchers</h1>
        {purchased ? (
          <div className="gift-voucher-done" role="status">
            <Check size={20} aria-hidden="true" />
            <p>Thank you. The voucher code is on its way to your inbox — forward it, or print it, whichever suits.</p>
          </div>
        ) : null}
        <p className="gift-voucher-lead">
          A voucher lets someone choose their own photograph, size and frame. It arrives by email as a
          single-use code, entered in the promotion field at checkout, and it doesn’t expire.
        </p>
        <form className="gift-voucher-form" onSubmit={buy}>
          <fieldset>
            <legend>Amount</legend>
            <div className="gift-voucher-amounts" role="radiogroup" aria-label="Voucher amount">
              {AMOUNTS.map((cents) => (
                <label className={`gift-voucher-amount${amountCents === cents ? " is-selected" : ""}`} key={cents}>
                  <input checked={amountCents === cents} name="gift-amount" onChange={() => setAmountCents(cents)} type="radio" />
                  <span>{money(cents / 100)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label>Recipient’s name<input onChange={(event) => setRecipientName(event.target.value)} required maxLength={120} value={recipientName} /></label>
          <label>Your name <span>(optional)</span><input autoComplete="name" onChange={(event) => setBuyerName(event.target.value)} maxLength={120} value={buyerName} /></label>
          <label>Your email<input autoComplete="email" onChange={(event) => setBuyerEmail(event.target.value)} required type="email" value={buyerEmail} /></label>
          <label>Message <span>(optional)</span><textarea maxLength={400} onChange={(event) => setMessage(event.target.value)} rows={3} value={message} /></label>
          <p className="gift-voucher-note">The code is emailed to you, so you can pass it on however you like.</p>
          {error ? <p className="co-error">{error}</p> : null}
          <button className="solid-button" disabled={starting} type="submit">
            {starting ? <><LoaderCircle className="spin" size={15} aria-hidden="true" /> Opening secure payment…</> : `Buy a ${money(amountCents / 100)} voucher`}
          </button>
        </form>
      </article>
      <ShopLegalFooter />
    </main>
  );
}
