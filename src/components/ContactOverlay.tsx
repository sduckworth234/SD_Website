import { Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { trackContactFormOpened, trackContactFormSubmitted } from "../lib/analytics";
import { usePublicContent } from "../lib/publicContent";

export function ContactOverlay({
  context = "Website enquiry",
  intro,
  onClose,
}: {
  context?: string;
  intro?: string;
  onClose: () => void;
}) {
  const content = usePublicContent();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    trackContactFormOpened({ source: context });
    nameRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [context, onClose]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, message, context, website: form.get("website") }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Your message could not be sent.");
      setStatus("sent");
      trackContactFormSubmitted({ source: context });
    } catch (submitError) {
      setStatus("error");
      setError(submitError instanceof Error ? submitError.message : "Your message could not be sent.");
    }
  }

  return (
    <div className="contact-overlay" role="dialog" aria-modal="true" aria-labelledby="contact-title">
      <button className="lightbox-backdrop" onClick={onClose} type="button" aria-label="Close contact form" />
      <section className="contact-panel">
        <button className="icon-button close-button" onClick={onClose} type="button" aria-label="Close contact form">
          <X size={18} aria-hidden="true" />
        </button>
        {status === "sent" ? (
          <div className="contact-success" role="status">
            <Check size={24} aria-hidden="true" />
            <p className="eyebrow">Message sent</p>
            <h2 id="contact-title">Thanks, {name}.</h2>
            <p className="contact-lead">Your enquiry is in my inbox. I’ll reply to {email}.</p>
            <button className="solid-button" type="button" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <p className="eyebrow">{content.contactEyebrow}</p>
            <h2 id="contact-title">{content.contactHeading}</h2>
            <p className="contact-lead">{intro ?? content.contactIntro}</p>
            <form className="contact-form" onSubmit={submit}>
              <label>Name
                <input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} type="text" autoComplete="name" placeholder="Your name" required minLength={2} />
              </label>
              <label>Email
                <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="you@example.com" required />
              </label>
              <label>Message
                <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={5} placeholder="What can I help with?" required minLength={10} />
              </label>
              <label className="contact-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
              {error ? <p className="contact-error" role="alert">{error}</p> : null}
              <button className="solid-button" type="submit" disabled={status === "sending"}>
                {status === "sending" ? <><LoaderCircle className="spin" size={15} aria-hidden="true" /> Sending…</> : "Send message"}
              </button>
            </form>
            <p className="contact-alt">Prefer your own email app? <a href={`mailto:${content.publicEmail}`}>{content.publicEmail}</a></p>
          </>
        )}
      </section>
    </div>
  );
}
