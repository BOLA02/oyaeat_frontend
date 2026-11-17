"use client";

export default function NewsletterForm() {
  return (
    <div className="rounded-xl border border-white/20 bg-white/5 p-4 text-sm text-white/75">
      Newsletter signup is coming soon. Follow OyaEat&apos;s official channels for launch updates.
    </div>
    /* No form is shown until a documented subscription endpoint exists. */
    /*
    <form className="flex gap-2">
      <label htmlFor="footer-email" className="sr-only">
        Email address
      </label>
      <input
        id="footer-email"
        type="email"
        required
        placeholder="your@email.com"
        className="flex-1 min-w-0 bg-white/10 border border-white/20 rounded-full px-5 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:border-[var(--lp-mango)] transition-colors font-medium"
      />
      <button
        type="submit"
        className="px-5 py-3 bg-[var(--lp-mango)] text-[var(--lp-violet-950)] text-sm font-extrabold rounded-full hover:brightness-105 transition whitespace-nowrap flex-shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        Subscribe
      </button>
    </form>
    */
  );
}
