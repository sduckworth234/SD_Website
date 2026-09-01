import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useCart } from "../lib/cart";
import { trackBeginCheckout, trackViewCart } from "../lib/analytics";
import { colourById, glazingById, money } from "../lib/printCatalogue";
import { LegalNav } from "./LegalPages";

export function CartDrawer({
  open,
  onClose,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (route: string) => void;
}) {
  const cart = useCart();
  const drawerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (cart.items.length) {
      trackViewCart({
        currency: "AUD",
        value: cart.subtotal + cart.shipping,
        items: cart.items.map((item) => ({
          item_id: item.photoId,
          item_name: item.title,
          item_brand: "Sam Duckworth Photography",
          item_category: "Fine-art print",
          item_variant: `${item.size} · ${colourById(item.colour).label} · ${item.mounted ? "Mounted" : "Unmounted"} · ${glazingById(item.glazing).label}`,
          price: item.price,
          quantity: 1,
        })),
      });
    }
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const closeButton = drawerRef.current?.querySelector<HTMLButtonElement>('[aria-label="Close cart"]');
    closeButton?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [cart.items, cart.shipping, cart.subtotal, onClose, open]);

  function checkout() {
    if (!cart.items.length) return;
    trackBeginCheckout({
      currency: "AUD",
      value: cart.subtotal + cart.shipping,
      items: cart.items.map((item) => ({
        item_id: item.photoId,
        item_name: item.title,
        item_brand: "Sam Duckworth Photography",
        item_category: "Fine-art print",
        item_variant: `${item.size} · ${colourById(item.colour).label} · ${item.mounted ? "Mounted" : "Unmounted"} · ${glazingById(item.glazing).label}`,
        price: item.price,
        quantity: 1,
      })),
    });
    onClose();
    window.history.pushState({}, "", "/checkout");
    onNavigate("/checkout");
  }

  return (
    <>
      <div className={`pc-scrim${open ? " open" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside
        ref={drawerRef}
        className={`pc-cart-drawer${open ? " open" : ""}`}
        aria-label="Cart"
        aria-hidden={!open}
        aria-modal={open ? "true" : undefined}
        inert={!open}
        role="dialog"
      >
        <div className="pc-cart-head">
          <h3>Your cart</h3>
          <button type="button" onClick={onClose} aria-label="Close cart"><X size={18} aria-hidden="true" /></button>
        </div>
        <div className="pc-cart-items">
          {cart.items.length === 0 ? (
            <p className="pc-cart-empty">Nothing in your cart yet — configure a print and add it.</p>
          ) : (
            cart.items.map((item, index) => (
              <div className="pc-cart-item" key={`${item.photoId}-${index}`}>
                <img src={item.thumb} alt={item.title} />
                <div className="pc-ci-info">
                  <b>{item.title}</b>
                  <span>{item.size} · {colourById(item.colour).label} · {item.mounted ? "Mounted" : "Unmounted"} · {glazingById(item.glazing).label}</span>
                  <button className="pc-ci-remove" type="button" onClick={() => cart.remove(index)}>Remove</button>
                </div>
                <div className="pc-ci-price">{money(item.price)}</div>
              </div>
            ))
          )}
        </div>
        <div className="pc-cart-foot">
          {cart.items.length ? (
            <div className="pc-cart-lines">
              <div className="row"><span>Subtotal</span><span>{money(cart.subtotal)}</span></div>
              <div className="row"><span>Shipping (AU)</span><span>{money(cart.shipping)}</span></div>
              <div className="row total"><span>Estimated total</span><span>{money(cart.subtotal + cart.shipping)}</span></div>
            </div>
          ) : null}
          <p className="pc-au-note">Shipping within Australia only. Exact cost is confirmed at checkout, where you can also choose free collection on the Northern Beaches.</p>
          <button className="pc-checkout-btn" disabled={!cart.items.length} type="button" onClick={checkout}>Secure checkout</button>
          <p className="pc-checkout-note">Promotion codes and gift vouchers are applied securely at checkout.</p>
          <p className="pc-checkout-note"><a href="/shop/gift-voucher" onClick={(event) => { event.preventDefault(); onClose(); window.history.pushState({}, "", "/shop/gift-voucher"); onNavigate("/shop/gift-voucher"); }}>Buy a gift voucher</a></p>
          <LegalNav className="pc-cart-policies" />
        </div>
      </aside>
    </>
  );
}
