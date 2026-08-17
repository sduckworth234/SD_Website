import { useSeo } from "../lib/seo";
import { usePublicContent } from "../lib/publicContent";

export type LegalPageId = "privacy" | "terms" | "shipping" | "returns";

const LEGAL_LINKS: ReadonlyArray<{ id: LegalPageId; label: string }> = [
  { id: "shipping", label: "Shipping" },
  { id: "returns", label: "Returns & damaged orders" },
  { id: "privacy", label: "Privacy" },
  { id: "terms", label: "Terms of purchase" },
];

export function LegalNav({ className = "" }: { className?: string }) {
  return (
    <nav className={`legal-nav ${className}`.trim()} aria-label="Shop policies">
      {LEGAL_LINKS.map(({ id, label }) => (
        <a key={id} href={`/shop/policies/${id}`}>{label}</a>
      ))}
    </nav>
  );
}

export function ShopLegalFooter({ className = "" }: { className?: string }) {
  const content = usePublicContent();
  return (
    <footer className={`shop-legal-footer ${className}`.trim()}>
      <a className="shop-photography-link" href="/galleries">Explore the photography galleries →</a>
      <LegalNav />
      <p>
        Questions? Email <a href={`mailto:${content.publicEmail}`}>{content.publicEmail}</a>.
      </p>
      <p>© {new Date().getFullYear()} {content.siteName}</p>
    </footer>
  );
}

function PolicyShell({
  id,
  title,
  intro,
  children,
}: {
  id: LegalPageId;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  const content = usePublicContent();
  useSeo(`${title} — ${content.siteName}`, {
    description: `${intro} Shop policies for made-to-order photography prints from ${content.siteName}.`,
    path: `/shop/policies/${id}`,
  });

  return (
    <main className="legal-page">
      <nav className="legal-page__top" aria-label="Policy navigation">
        <a href="/shop">← Back to Framed Editions</a>
        <a href="/galleries">Photography galleries →</a>
      </nav>
      <article className="legal-page__article">
        <p className="legal-page__eyebrow">{content.siteName}</p>
        <h1>{title}</h1>
        <p className="legal-page__updated">Last updated 17 August 2026</p>
        <p className="legal-page__intro">{intro}</p>
        {children}
        <section>
          <h2>Contact</h2>
          <p>
            Email <a href={`mailto:${content.publicEmail}`}>{content.publicEmail}</a> with your order
            number and we’ll help.
          </p>
        </section>
      </article>
      <ShopLegalFooter />
    </main>
  );
}

function ShippingPolicy() {
  return (
    <PolicyShell
      id="shipping"
      title="Shipping & delivery"
      intro="Prints are made to order and currently delivered within Australia only."
    >
      <section>
        <h2>Production</h2>
        <p>
          Each print is produced for your order. Most orders are typically dispatched in
          2–3 business days. If an order needs longer, we’ll contact you using the email
          supplied at checkout.
        </p>
      </section>
      <section>
        <h2>Delivery costs</h2>
        <p>
          Tracked Australia-wide delivery is calculated at checkout. Additional prints ship
          from $5 when they can be packed together. The total shown before payment is the
          delivery price for your order.
        </p>
      </section>
      <section>
        <h2>Tracking and delivery</h2>
        <p>
          We’ll email tracking details when your order leaves production. Delivery estimates
          are estimates rather than guarantees, and regional or carrier delays can happen.
          Please check your address carefully before paying.
        </p>
      </section>
      <section>
        <h2>Address changes</h2>
        <p>
          Contact us within 45 minutes of purchase if your delivery details need changing.
          Once production or dispatch has started, an address change may not be possible.
        </p>
      </section>
    </PolicyShell>
  );
}

function ReturnsPolicy() {
  return (
    <PolicyShell
      id="returns"
      title="Returns, damage & cancellations"
      intro="We want your print to arrive in excellent condition and match what you ordered."
    >
      <section>
        <h2>Changing or cancelling an order</h2>
        <p>
          Contact us within 45 minutes of purchase if you need to change or cancel an order.
          Because every print is made to order, we may not be able to change or cancel it once
          production has started.
        </p>
      </section>
      <section>
        <h2>Damaged, faulty or incorrect orders</h2>
        <p>
          Email us as soon as practical with your order number, a description of the issue,
          photographs of the print and packaging, and a photograph of the shipping label.
          Keep the item and packaging while we assess the issue. Where appropriate, we’ll
          arrange a replacement, repair or refund.
        </p>
      </section>
      <section>
        <h2>Change of mind</h2>
        <p>
          As prints are made to your selected photograph, size, frame and mount, we generally
          do not accept change-of-mind returns. Please review the preview and options carefully
          before paying.
        </p>
      </section>
      <section>
        <h2>Your consumer rights</h2>
        <p>
          Nothing in this policy excludes or limits rights and remedies that cannot be excluded
          under the Australian Consumer Law, including consumer guarantees for faulty goods.
        </p>
      </section>
    </PolicyShell>
  );
}

function PrivacyPolicy() {
  return (
    <PolicyShell
      id="privacy"
      title="Privacy policy"
      intro="This explains what information the shop uses and why."
    >
      <section>
        <h2>Information we collect</h2>
        <p>
          When you browse or order, we may receive your name, email, phone number, delivery
          address, order details, messages, device and browser information, and website usage
          data. Payment-card details are collected and processed securely by Stripe; we do not
          receive or store your full card number.
        </p>
      </section>
      <section>
        <h2>How we use it</h2>
        <p>
          We use information to process and deliver orders, send receipts and order updates,
          provide support, prevent fraud, meet legal and accounting obligations, and understand
          how the website can be improved. We do not sell your personal information.
        </p>
      </section>
      <section>
        <h2>Services involved</h2>
        <p>
          We share only what is needed with services that help run the shop, such as payment,
          hosting, database, email, analytics, printing and delivery providers. Those providers
          may process information outside Australia under their own privacy terms.
        </p>
      </section>
      <section>
        <h2>Analytics and local storage</h2>
        <p>
          The website uses analytics to measure visits and shopping interactions. It also uses
          browser storage for functions such as your cart and display preference. You can limit
          cookies or analytics through your browser, though some preferences may not persist.
        </p>
      </section>
      <section>
        <h2>Access, correction and deletion</h2>
        <p>
          You can ask what personal information we hold, request a correction, or ask us to
          delete information we no longer need to retain. Some order records must be kept for
          legal, tax, fraud-prevention or dispute purposes.
        </p>
      </section>
    </PolicyShell>
  );
}

function TermsPolicy() {
  return (
    <PolicyShell
      id="terms"
      title="Terms of purchase"
      intro="These terms apply when you order a print from Sam Duckworth Photography."
    >
      <section>
        <h2>Your order</h2>
        <p>
          Please check the photograph, size, frame, mount, delivery address and total before
          paying. An order is accepted when payment succeeds and we send confirmation. If a
          pricing, availability or technical error prevents fulfilment, we’ll contact you and
          provide an appropriate resolution, including a refund where required.
        </p>
      </section>
      <section>
        <h2>Prices and payment</h2>
        <p>
          Prices are shown in Australian dollars. Delivery and any discount are shown before
          payment. Payments are processed securely by Stripe. Promotion codes are subject to
          their stated conditions and cannot be exchanged for cash.
        </p>
      </section>
      <section>
        <h2>Made-to-order colour and appearance</h2>
        <p>
          Screens display colour and brightness differently. We take care to present each image
          and frame accurately, but a physical print may vary slightly from its on-screen
          preview. Studio scenes are visual guides and are not exact measurements of your room.
        </p>
      </section>
      <section>
        <h2>Copyright</h2>
        <p>
          Buying a print does not transfer copyright or grant permission to reproduce, scan,
          publish or commercially use the photograph. Copyright remains with Sam Duckworth.
        </p>
      </section>
      <section>
        <h2>Shipping, changes and problems</h2>
        <p>
          Our <a href="/shop/policies/shipping">shipping policy</a> and {" "}
          <a href="/shop/policies/returns">returns, damage and cancellation policy</a> form
          part of these terms. Nothing here limits rights that cannot be excluded under the
          Australian Consumer Law.
        </p>
      </section>
    </PolicyShell>
  );
}

export function LegalPage({ page }: { page: LegalPageId }) {
  if (page === "shipping") return <ShippingPolicy />;
  if (page === "returns") return <ReturnsPolicy />;
  if (page === "privacy") return <PrivacyPolicy />;
  return <TermsPolicy />;
}
