/**
 * Browser-side payment helpers. Talks ONLY to our own server functions —
 * no Stripe keys of any kind live in client code.
 */
(function () {
  async function callApi(url, options) {
    if (window.location.protocol === 'file:') {
      throw new Error('Payments need the local server. Run "npm start" and open http://localhost:8080.');
    }
    let res;
    try {
      res = await fetch(url, options);
    } catch {
      throw new Error('Could not reach the server. Please check your connection and try again.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
    return data;
  }

  window.Payments = {
    DEPOSIT_LABEL: 'AED 100',

    /** Creates a Checkout Session on the server for a pending appointment and redirects to Stripe. */
    async startCheckout(appointment) {
      const session = await callApi('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointment_id: appointment.id })
      });
      window.location.assign(session.url);
    },

    /** Asks the server to check the Checkout Session with Stripe (the server updates the appointment). */
    async verify(sessionId) {
      return callApi('/api/verify-checkout-session?session_id=' + encodeURIComponent(sessionId), {
        headers: { Accept: 'application/json' }
      });
    }
  };
})();
