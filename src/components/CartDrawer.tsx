import { X } from "lucide-react";
import { useCart } from "../lib/cart";
import { colourById, money } from "../lib/printCatalogue";

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

  function checkout() {
    if (!cart.items.length) return;
    onClose();
    window.history.pushState({}, "", "/checkout");
    onNavigate("/checkout");
  }

  return (
    <>
      <div className={`pc-scrim${open ? " open" : ""}`} onClick={onClose} />
      <aside className={`pc-cart-drawer${open ? " open" : ""}`} aria-label="Cart" aria-hidden={!open}>
        <div className="pc-cart-head">
          <h3>Your cart</h3>
          <button type="button" onClick={onClose} aria-label="Close cart"><X size={18} /></button>
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
                  <span>{item.size} · {colourById(item.colour).label} · {item.mounted ? "Mounted" : "Unmounted"}</span>
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
          <p className="pc-au-note">Shipping within Australia only. Exact cost is confirmed at checkout.</p>
          <button className="pc-checkout-btn" disabled={!cart.items.length} type="button" onClick={checkout}>Secure checkout</button>
          <p className="pc-checkout-note">Promotion codes are applied securely at checkout.</p>
        </div>
      </aside>
    </>
  );
}
