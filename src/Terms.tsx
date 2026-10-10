
import { useEffect } from 'react';

export default function Terms() {
  useEffect(() => {
    document.title = 'Terms of Service | Shinzi';
  }, []);

  return (
    <main className="terms-page">
      <article className="terms-content">
        <header className="terms-header">
          <h1>Shinzi Terms of Service</h1>
          <p className="terms-effective">
            Effective date: To be announced
          </p>
          <p>
            Welcome to Shinzi. These Terms of Service explain
            the rules for using Shinzi and its available
            features. By using Shinzi, you agree to follow
            these Terms and applicable laws.
          </p>
        </header>

        <section>
          <h2>1. Account Security and Ownership</h2>
          <p>
            You must provide accurate account information and
            keep your login credentials secure. Do not
            impersonate another person, share access in an
            unauthorized way, or access another person's
            account or private information without permission.
            You are responsible for activity carried out
            through your account, except where applicable law
            provides otherwise.
          </p>
        </section>

        <section>
          <h2>2. Prohibited Activities</h2>
          <p>You must not use Shinzi to:</p>
          <ul>
            <li>Hack accounts, exploit vulnerabilities, or bypass security.</li>
            <li>Steal credentials, data, assets, or other users' property.</li>
            <li>Commit scams, fraud, or unauthorized payment activity.</li>
            <li>Harass, threaten, bully, or impersonate other users.</li>
            <li>Distribute malware or interfere with Shinzi's services.</li>
            <li>Break applicable laws or abuse Shinzi's features.</li>
          </ul>
        </section>

        <section>
          <h2>3. Warnings, Suspensions and Bans</h2>
          <p>
            Minor violations may result in a warning or
            restriction. Serious abuse may result in immediate
            suspension or a permanent ban. Repeated violations
            may lead to stronger penalties. Shinzi will
            consider the nature and severity of a violation
            when deciding what action is appropriate.
          </p>
        </section>

        <section>
          <h2>4. Ban Appeals</h2>
          <p>
            If your account is suspended or banned, you may
            request a review through Shinzi's designated
            support or appeal method. Shinzi may review
            relevant information and uphold, reduce, or
            reverse the decision. Submitting an appeal does
            not guarantee that the decision will change.
          </p>
        </section>

        <section>
          <h2>5. Shazax, Payments and Subscriptions</h2>
          <p>
            Shinzi may offer Shazax virtual currency,
            subscriptions, and other paid features. Prices,
            billing periods, included benefits, and applicable
            purchase conditions will be shown through the
            relevant purchase process.
          </p>
          <p>
            Virtual currency and digital benefits may be
            subject to restrictions relating to fraud, abuse,
            account suspension, or service closure. Refunds,
            cancellations, and unused balances will be handled
            according to the applicable purchase terms and
            consumer-protection laws. Nothing in these Terms
            removes rights that cannot legally be excluded.
          </p>
          <p>
            Do not use stolen payment details, conduct
            fraudulent transactions, or attempt to manipulate
            purchases or balances.
          </p>
        </section>

        <section>
          <h2>6. Service Changes and Account Termination</h2>
          <p>
            Shinzi may update, improve, restrict, or
            discontinue features, including when necessary
            for security, maintenance, legal compliance, or
            service operation. We may suspend or terminate
            accounts in accordance with these Terms. Material
            changes to these Terms will be communicated where
            appropriate or required by law.
          </p>
        </section>

        <section>
          <h2>7. Service Availability</h2>
          <p>
            We aim to keep Shinzi available, but uninterrupted
            service cannot be guaranteed. Maintenance,
            technical problems, third-party outages, or other
            circumstances may temporarily affect access to
            features.
          </p>
        </section>

        <section>
          <h2>8. Changes to These Terms</h2>
          <p>
            Shinzi may revise these Terms as the service
            evolves. The latest version will be published on
            this page with an updated effective date. Where
            required, users will be notified of material
            changes before they take effect.
          </p>
        </section>

        <section>
          <h2>9. Contact and Questions</h2>
          <p>
            If you have questions about these Terms, account
            restrictions, or an appeal, contact Shinzi through
            its designated support channel. Official contact
            details will be provided here before public release.
          </p>
        </section>

        <footer className="terms-footer">
          © {new Date().getFullYear()} Shinzi. All rights reserved.
        </footer>
      </article>

      <style>{`
        .terms-page,
        .terms-page * {
          box-sizing: border-box;
        }

        .terms-page {
          --terms-bg: #080612;
          --terms-surface: #17102A;
          --terms-border: #39265D;
          --terms-text: #FFFFFF;
          --terms-muted: #A6A2B5;
          --terms-accent: #20D9FF;

          width: 100%;
          min-height: 100vh;
          min-height: 100dvh;
          background: var(--terms-bg);
          color: var(--terms-text);

          font-family:
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            Roboto,
            Helvetica,
            Arial,
            sans-serif;

          -webkit-font-smoothing: antialiased;
          overflow: visible;
        }

        .terms-content {
          width: 100%;
          max-width: 850px;
          margin: 0 auto;
          padding: 32px 24px 48px;
          line-height: 1.65;
          animation: terms-enter 0.4s ease-out both;
        }

        .terms-header {
          margin-bottom: 32px;
        }

        .terms-content h1 {
          margin: 0 0 12px;
          color: var(--terms-text);
          font-size: clamp(28px, 5vw, 40px);
          font-weight: 800;
          letter-spacing: -0.5px;
          line-height: 1.2;
        }

        .terms-effective {
          margin: 0 0 22px;
          color: var(--terms-muted);
          font-size: 15px;
        }

        .terms-content h2 {
          margin: 32px 0 14px;
          color: var(--terms-text);
          font-size: clamp(20px, 4vw, 26px);
          font-weight: 700;
          line-height: 1.3;
        }

        .terms-content p,
        .terms-content li {
          color: var(--terms-muted);
          font-size: 16px;
          font-weight: 400;
          overflow-wrap: anywhere;
        }

        .terms-content p {
          margin: 0 0 16px;
        }

        .terms-content ul {
          margin: 12px 0 20px;
          padding-left: 26px;
        }

        .terms-content li {
          padding-left: 3px;
          margin-bottom: 10px;
        }

        .terms-content li::marker {
          color: var(--terms-accent);
        }

        .terms-footer {
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid var(--terms-border);
          color: var(--terms-muted);
          font-size: 13px;
        }

        @keyframes terms-enter {
          from {
            opacity: 0;
            transform: translateY(10px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (min-width: 768px) {
          .terms-content {
            padding: 48px 40px 60px;
          }

          .terms-content p,
          .terms-content li {
            font-size: 17px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .terms-content {
            animation: none;
          }
        }
        html:has(.terms-page),
body:has(.terms-page),
#root:has(.terms-page) {
  height: auto !important;
  min-height: 100% !important;
  overflow-y: auto !important;
  overflow-x: hidden !important;
}
      `}</style>
    </main>
  );
}
