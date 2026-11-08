import { useMemo, useState, type FormEvent } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import type { Intent } from "../../api/types";
import { money } from "../../lib/format";

/**
 * Real Stripe test mode. Card details are typed into Stripe's own iframe (PaymentElement),
 * so they never touch this app or the payment service: that keeps the store out of most
 * PCI scope. Stripe then tells payment-service by webhook.
 */
export default function StripePay({ intent, onPaid }: { intent: Intent; onPaid: () => void }) {
  const stripe = useMemo(() => loadStripe(intent.publishableKey ?? ""), [intent.publishableKey]);
  return (
    <Elements stripe={stripe} options={{ clientSecret: intent.clientSecret, appearance: { theme: "stripe" } }}>
      <CardForm amount={intent.amountCents} onPaid={onPaid} />
    </Elements>
  );
}

function CardForm({ amount, onPaid }: { amount: number; onPaid: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: window.location.href },
    });
    setBusy(false);
    if (error) setError(error.message ?? "Payment failed.");
    else if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") onPaid();
  };

  return (
    <form onSubmit={submit} className="stripe-form">
      <PaymentElement />
      {error && <p className="note note-error" role="alert">{error}</p>}
      <button className="btn btn-primary btn-wide" disabled={!stripe || busy}>{busy ? "Paying…" : `Pay ${money(amount)}`}</button>
      <p className="muted small">Test card: 4242 4242 4242 4242, any future date, any CVC.</p>
    </form>
  );
}
