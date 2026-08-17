import { CheckoutElementsProvider, PaymentElement, ShippingAddressElement, useCheckoutElements } from "@stripe/react-stripe-js/checkout";
import { loadStripe } from "@stripe/stripe-js";
import type { StripeCheckoutSession } from "@stripe/stripe-js";
import { ArrowLeft, Check, LoaderCircle, Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCart } from "../lib/cart";
import { trackAddShippingInfo, trackPurchase } from "../lib/analytics";
import { colourById, money } from "../lib/printCatalogue";
import { usePublicContent } from "../lib/publicContent";
import { useSeo } from "../lib/seo";
import { supabase } from "../lib/supabase";

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const stripePromise = publishableKey ? loadStripe(publishableKey) : Promise.resolve(null);

const appearance = {
  theme: "night" as const,
  variables: {
    colorPrimary: "#c7a675",
    colorBackground: "#171716",
    colorText: "#f2eee7",
    colorDanger: "#dc756f",
    colorTextSecondary: "#aaa49a",
    fontFamily: "Archivo, system-ui, sans-serif",
    borderRadius: "3px",
    spacingUnit: "4px",
  },
  rules: {
    ".Input": { border: "1px solid #3a3834", boxShadow: "none" },
    ".Input:focus": { border: "1px solid #c7a675", boxShadow: "0 0 0 1px #c7a675" },
    ".Label": { color: "#c9c3b9" },
  },
};

type Customer = {
  name: string;
  email: string;
  phone: string;
};

const EMPTY_CUSTOMER: Customer = {
  name: "",
  email: "",
  phone: "",
};

type CheckoutTotals = {
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  promotionCode: string | null;
};

function totalsFromStripe(session: StripeCheckoutSession): CheckoutTotals {
  const divisor = session.minorUnitsAmountDivisor || 100;
  const promotion = session.discountAmounts?.find((discount) => discount.promotionCode);
  return {
    subtotal: session.total.subtotal.minorUnitsAmount / divisor,
    shipping: session.total.shippingRate.minorUnitsAmount / divisor,
    discount: session.total.discount.minorUnitsAmount / divisor,
    total: session.total.total.minorUnitsAmount / divisor,
    promotionCode: promotion?.promotionCode ?? null,
  };
}

function go(path: string, onNavigate: (path: string) => void) {
  window.history.pushState({}, "", path);
  onNavigate(path);
}

function PolicyLinks() {
  return (
    <nav className="co-policy-links" aria-label="Shop policies">
      <a href="/shop/policies/shipping">Shipping</a>
      <span aria-hidden="true"> · </span>
      <a href="/shop/policies/returns">Returns</a>
      <span aria-hidden="true"> · </span>
      <a href="/shop/policies/privacy">Privacy</a>
      <span aria-hidden="true"> · </span>
      <a href="/shop/policies/terms">Terms</a>
    </nav>
  );
}

function PaymentStep({ onBack, onRetry }: { onBack: () => void; onRetry: () => void }) {
  const cart = useCart();
  const checkoutState = useCheckoutElements();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [loadTimedOut, setLoadTimedOut] = useState(false);

  useEffect(() => {
    if (checkoutState.type !== "loading") {
      setLoadTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setLoadTimedOut(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [checkoutState.type]);

  if (checkoutState.type === "loading") return loadTimedOut ? (
    <div className="co-payment-failed" role="alert">
      <p>Secure payment is taking longer than expected.</p>
      <span>We can reconnect to the same secure checkout session. You won’t be charged and a new order won’t be created.</span>
      <button type="button" onClick={onRetry}>Try loading again</button>
      <button type="button" onClick={onBack}>Return to contact details</button>
    </div>
  ) : (
    <div className="co-payment-loading" aria-live="polite">
      <LoaderCircle className="spin" aria-hidden="true" />
      <div>
        <b>Connecting securely to Stripe…</b>
        <span>This can take a few seconds. Your order details are ready.</span>
      </div>
    </div>
  );
  if (checkoutState.type === "error") return <p className="co-error">{checkoutState.error.message}</p>;
  const { checkout } = checkoutState;

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    trackAddShippingInfo({
      currency: "AUD",
      value: cart.subtotal + cart.shipping,
      shipping_tier: "Tracked Australia-wide delivery",
      items: cart.items.map((item) => ({
        item_id: item.photoId,
        item_name: item.title,
        item_brand: "Sam Duckworth Photography",
        item_category: "Fine-art print",
        item_variant: `${item.size} · ${colourById(item.colour).label} · ${item.mounted ? "Mounted" : "Unmounted"}`,
        price: item.price,
        quantity: 1,
      })),
    });
    const result = await checkout.confirm();
    if (result.type === "error") {
      setMessage(result.error.message || "Payment could not be completed.");
      setSubmitting(false);
    }
  }

  return (
    <form className="co-payment" onSubmit={pay}>
      <div className="co-section-head"><span>02</span><div><p>Secure payment</p><small>Card and wallet details go directly to Stripe.</small></div></div>
      <div className="co-stripe-block">
        <div className="co-stripe-block-head"><p>Delivery address</p><small>Start typing your street and select the matching Australian address.</small></div>
        <ShippingAddressElement />
      </div>
      <div className="co-stripe-block">
        <div className="co-stripe-block-head"><p>Payment details</p><small>Securely processed by Stripe.</small></div>
        <PaymentElement options={{ layout: "accordion" }} />
      </div>
      {message ? <p className={message.endsWith("applied.") ? "co-success" : "co-error"}>{message}</p> : null}
      <button className="co-pay" disabled={submitting || !checkout.canConfirm} type="submit">
        {submitting ? <><LoaderCircle className="spin" size={16} /> Processing securely…</> : <>Pay {checkout.total.total.amount}</>}
      </button>
      <button className="co-back-step" disabled={submitting} onClick={onBack} type="button">Edit delivery details</button>
      <p className="co-secure"><Lock size={12} /> Encrypted payment powered by Stripe</p>
      <PolicyLinks />
    </form>
  );
}

type CartState = ReturnType<typeof useCart>;

function OrderSummary({ cart, totals }: { cart: CartState; totals?: CheckoutTotals | null }) {
  const [expanded, setExpanded] = useState(() => !window.matchMedia("(max-width: 800px)").matches);
  return (
    <aside className="co-summary">
      <button
        className="co-summary-title"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span>Your order <em>{cart.items.length}</em></span>
        <strong>{money(totals?.total ?? cart.subtotal + cart.shipping)}</strong>
        <small>{expanded ? "Hide" : "Show"}</small>
      </button>
      <div className={`co-summary-content${expanded ? " is-open" : ""}`}>
        <div className="co-summary-items">
          {cart.items.map((item, index) => <div className="co-summary-item" key={`${item.photoId}-${index}`}><img alt="" src={item.thumb} /><div><b>{item.title}</b><span>{item.size} · {colourById(item.colour).label} · {item.mounted ? "Mounted" : "Unmounted"}</span></div><strong>{money(item.price)}</strong></div>)}
        </div>
        <div className="co-summary-lines">
          <p><span>Subtotal</span><span>{money(totals?.subtotal ?? cart.subtotal)}</span></p>
          {totals?.discount ? <p className="discount"><span>{totals.promotionCode ? `Promotion (${totals.promotionCode})` : "Promotion discount"}</span><span>−{money(totals.discount)}</span></p> : null}
          <p><span>{totals ? "Delivery" : "Estimated delivery"}</span><span>{money(totals?.shipping ?? cart.shipping)}</span></p>
          <p className="total"><span>{totals ? "Total" : "Estimated total"}</span><span>{money(totals?.total ?? cart.subtotal + cart.shipping)}</span></p>
        </div>
        <div className="co-hold"><Check size={15} /><p><b>45-minute change window</b><span>Need to change something? Contact us within 45 minutes of purchase and we’ll pause fulfilment.</span></p></div>
        <p className="co-summary-note">The secure payment step confirms the live delivery price and any promotion code.</p>
        <PolicyLinks />
      </div>
    </aside>
  );
}

function StripeOrderSummary({ cart }: { cart: CartState }) {
  const checkoutState = useCheckoutElements();
  const totals = checkoutState.type === "success" ? totalsFromStripe(checkoutState.checkout) : null;
  return <OrderSummary cart={cart} totals={totals} />;
}

function CheckoutLayout({ children, summary }: { children: ReactNode; summary: ReactNode }) {
  return (
    <div className="co-layout">
      <section className="co-main">
        <p className="co-kicker">Sam Duckworth Photography</p>
        <h1>Complete your order.</h1>
        {children}
      </section>
      {summary}
    </div>
  );
}

export function CheckoutPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const cart = useCart();
  useSeo("Secure checkout — Sam Duckworth Photography", {
    description: "Secure checkout for a Sam Duckworth Photography framed print.",
    path: "/checkout",
    noindex: true,
  });
  const [customer, setCustomer] = useState<Customer>(EMPTY_CUSTOMER);
  const [promotionCode, setPromotionCode] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [checkoutLoadAttempt, setCheckoutLoadAttempt] = useState(0);

  const options = useMemo(() => clientSecret ? {
    clientSecret,
    elementsOptions: { appearance },
  } : null, [clientSecret]);

  async function continueToPayment(event: React.FormEvent) {
    event.preventDefault();
    setStarting(true);
    setError("");
    try {
      const accessToken = supabase ? (await supabase.auth.getSession()).data.session?.access_token : null;
      const response = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          cart: cart.items.map(({ photoId, size, mounted, colour }) => ({ photoId, size, mounted, colour })),
          customer,
          promotionCode: promotionCode.trim() || undefined,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Checkout could not be started.");
      if (!data?.clientSecret) throw new Error("Stripe did not return a secure checkout session.");
      const sessionMode = data.clientSecret.startsWith("cs_test_") ? "test" : data.clientSecret.startsWith("cs_live_") ? "live" : null;
      const keyMode = publishableKey?.startsWith("pk_test_") ? "test" : publishableKey?.startsWith("pk_live_") ? "live" : null;
      if (sessionMode && keyMode && sessionMode !== keyMode) {
        console.error(`Stripe checkout mode mismatch: ${keyMode} publishable key with ${sessionMode} Checkout Session.`);
        throw new Error("Secure payment is temporarily unavailable because the Stripe client and server modes do not match.");
      }
      setCheckoutLoadAttempt(0);
      setClientSecret(data.clientSecret);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Checkout could not be started.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <main className="co-shell">
      <header className="co-header">
        <button onClick={() => go("/shop", onNavigate)} type="button"><ArrowLeft size={15} /> Framed Editions</button>
        <div className="co-brand">SD</div>
        <span>Checkout</span>
      </header>
      {clientSecret && options ? (
        <CheckoutElementsProvider key={checkoutLoadAttempt} options={options} stripe={stripePromise}>
          <CheckoutLayout summary={<StripeOrderSummary cart={cart} />}>
            <PaymentStep onBack={() => setClientSecret("")} onRetry={() => setCheckoutLoadAttempt((attempt) => attempt + 1)} />
          </CheckoutLayout>
        </CheckoutElementsProvider>
      ) : (
        <CheckoutLayout summary={<OrderSummary cart={cart} />}>
          {!publishableKey ? <p className="co-error">Stripe is ready in code; add VITE_STRIPE_PUBLISHABLE_KEY to this environment to enable payment.</p> : null}
          {!cart.items.length ? (
            <div className="co-empty"><p>Your cart is empty.</p><button onClick={() => go("/shop", onNavigate)} type="button">Return to the shop</button></div>
          ) : (
            <form className="co-details" onSubmit={continueToPayment}>
              <div className="co-section-head"><span>01</span><div><p>Contact details</p><small>Your Australian delivery address is matched in the secure next step.</small></div></div>
              <div className="co-fields two">
                <label>Full name<input autoComplete="name" onChange={(e) => setCustomer({ ...customer, name: e.target.value })} required value={customer.name} /></label>
                <label>Email<input autoComplete="email" onChange={(e) => setCustomer({ ...customer, email: e.target.value })} required type="email" value={customer.email} /></label>
              </div>
              <label>Phone <span>(optional)</span><input autoComplete="tel" onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} type="tel" value={customer.phone} /></label>
              <label>Promotion code <span>(optional)</span><input autoCapitalize="characters" autoComplete="off" onChange={(e) => setPromotionCode(e.target.value.toUpperCase())} placeholder="Enter code" value={promotionCode} /></label>
              {error ? <p className="co-error">{error}</p> : null}
              <button className="co-continue" disabled={starting || !publishableKey} type="submit">{starting ? <><LoaderCircle className="spin" size={16} /> Preparing payment…</> : "Continue to delivery & payment"}</button>
            </form>
          )}
        </CheckoutLayout>
      )}
    </main>
  );
}

type CheckoutStatus = {
  checkoutStatus: string;
  paymentStatus: string;
  customerEmail: string | null;
  amountTotal: number | null;
  order: { id: string; status: string; submitAfter: string; items: { title: string; size: string }[] } | null;
};

export function CheckoutSuccessPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const cart = useCart();
  const content = usePublicContent();
  useSeo(`Order confirmation — ${content.siteName}`, {
    description: `Your ${content.siteName} order confirmation.`,
    path: "/checkout/success",
    noindex: true,
  });
  const [status, setStatus] = useState<CheckoutStatus | null>(null);
  const [error, setError] = useState("");
  const purchaseTracked = useRef(false);
  const sessionId = new URLSearchParams(window.location.search).get("session_id") ?? "";

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let attempts = 0;
    async function load() {
      try {
        const response = await fetch(`/api/checkout-status?session_id=${encodeURIComponent(sessionId)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Order status could not be loaded.");
        if (cancelled) return;
        setStatus(data);
        if (["paid", "no_payment_required"].includes(data.paymentStatus)) cart.clear();
        if (!data.order && attempts++ < 8) timer = window.setTimeout(load, 1500);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Order status could not be loaded.");
      }
    }
    if (sessionId) load(); else setError("No checkout session was supplied.");
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [sessionId]);

  const paid = status && ["paid", "no_payment_required"].includes(status.paymentStatus);

  useEffect(() => {
    if (!paid || !status?.order || purchaseTracked.current) return;
    purchaseTracked.current = true;
    trackPurchase({
      transaction_id: status.order.id,
      currency: "AUD",
      value: (status.amountTotal ?? 0) / 100,
      items: status.order.items.map((item) => ({
        item_id: `${status.order?.id}-${item.title}-${item.size}`,
        item_name: item.title,
        item_brand: "Sam Duckworth Photography",
        item_category: "Fine-art print",
        item_variant: item.size,
        quantity: 1,
      })),
    });
  }, [paid, status]);
  return (
    <main className="co-result">
      <div className={paid ? "co-result-icon paid" : "co-result-icon"}>{paid ? <Check /> : <LoaderCircle className="spin" />}</div>
      <p className="co-kicker">Framed Editions</p>
      <h1>{paid ? "Thank you. Your order is confirmed." : "Confirming your order…"}</h1>
      {error ? <p className="co-error">{error}</p> : null}
      {paid ? (
        <>
          <p>Thank you for supporting my photography. A receipt and order confirmation will be sent to <b>{status.customerEmail}</b>.</p>
          {status.order ? (
            <p className="co-order-ref">Order {status.order.id.slice(0, 8).toUpperCase()} · {status.order.items.length} print{status.order.items.length === 1 ? "" : "s"}</p>
          ) : (
            <p>Your payment is confirmed; the order record is still being finalised.</p>
          )}
          <section className="co-result-next" aria-labelledby="co-result-next-title">
            <h2 id="co-result-next-title">What happens next</h2>
            <p>Your print will be prepared to order. We’ll email you again when it has been dispatched with tracking details.</p>
            <p>Need help? Email <a href={`mailto:${content.publicEmail}`}>{content.publicEmail}</a> or follow <a href={content.instagramUrl} target="_blank" rel="noreferrer">@{content.instagramHandle}</a>.</p>
          </section>
          <div className="co-result-actions">
            <button onClick={() => go("/shop", onNavigate)} type="button">Continue shopping</button>
            <button onClick={() => go("/galleries", onNavigate)} type="button">Return to the gallery</button>
          </div>
          <PolicyLinks />
        </>
      ) : error ? (
        <div className="co-result-actions">
          <button onClick={() => go("/shop", onNavigate)} type="button">Return to Framed Editions</button>
          <button onClick={() => go("/galleries", onNavigate)} type="button">Photography galleries</button>
        </div>
      ) : null}
    </main>
  );
}
