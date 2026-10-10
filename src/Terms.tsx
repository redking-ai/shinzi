
import { useEffect } from 'react';

const Terms = () => {
  useEffect(() => {
    document.title = 'Terms of Service | Shinzi';
  }, []);

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#0a0a0a',
        color: '#ffffff',
        padding: '32px 20px 60px',
        boxSizing: 'border-box',
      }}
    >
      <article
        style={{
          maxWidth: '850px',
          margin: '0 auto',
          lineHeight: 1.7,
        }}
      >
        <header style={{ marginBottom: '32px' }}>
          <h1
            style={{
              fontSize: 'clamp(28px, 5vw, 40px)',
              fontWeight: 700,
              margin: '0 0 10px',
            }}
          >
            Shinzi Terms of Service
          </h1>

          <p style={{ color: '#8e8e8e', margin: 0 }}>
            Effective date: To be announced
          </p>

          <p>
            Welcome to Shinzi. These Terms of Service explain the rules
            for using Shinzi and its available features. By using Shinzi,
            you agree to follow these Terms and applicable laws.
          </p>
        </header>

        <section>
          <h2>1. Account Security and Ownership</h2>
          <p>
            You must provide accurate account information and keep your
            login credentials secure. Do not impersonate another person,
            share access in an unauthorized way, or access another
            person's account or private information without permission.
            You are responsible for activity carried out through your
            account, except where applicable law provides otherwise.
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
            Minor violations may result in a warning or restriction.
            Serious abuse may result in immediate suspension or a
            permanent ban. Repeated violations may lead to stronger
            penalties. Shinzi will consider the nature and severity of
            a violation when deciding what action is appropriate.
          </p>
        </section>

        <section>
          <h2>4. Ban Appeals</h2>
          <p>
            If your account is suspended or banned, you may request a
            review through Shinzi's designated support or appeal method.
            Shinzi may review relevant information and uphold, reduce,
            or reverse the decision. Submitting an appeal does not
            guarantee that the decision will change.
          </p>
        </section>

        <section>
          <h2>5. Shazax, Payments and Subscriptions</h2>
          <p>
            Shinzi may offer Shazax virtual currency, subscriptions,
            and other paid features. Prices, billing periods, included
            benefits, and applicable purchase conditions will be shown
            through the relevant purchase process.
          </p>
          <p>
            Virtual currency and digital benefits may be subject to
            restrictions relating to fraud, abuse, account suspension,
            or service closure. Refunds, cancellations, and unused
            balances will be handled according to the applicable
            purchase terms and consumer-protection laws. Nothing in
            these Terms removes rights that cannot legally be excluded.
          </p>
          <p>
            Do not use stolen payment details, conduct fraudulent
            transactions, or attempt to manipulate purchases or balances.
          </p>
        </section>

        <section>
          <h2>6. Service Changes and Account Termination</h2>
          <p>
            Shinzi may update, improve, restrict, or discontinue
            features, including when necessary for security, maintenance,
            legal compliance, or service operation. We may suspend or
            terminate accounts in accordance with these Terms.
            Material changes to these Terms will be communicated where
            appropriate or required by law.
          </p>
        </section>

        <section>
          <h2>7. Service Availability</h2>
          <p>
            We aim to keep Shinzi available, but uninterrupted service
            cannot be guaranteed. Maintenance, technical problems,
            third-party outages, or other circumstances may temporarily
            affect access to features.
          </p>
        </section>

        <section>
          <h2>8. Changes to These Terms</h2>
          <p>
            Shinzi may revise these Terms as the service evolves.
            The latest version will be published on this page with an
            updated effective date. Where required, users will be
            notified of material changes before they take effect.
          </p>
        </section>

        <section>
          <h2>9. Contact and Questions</h2>
          <p>
            If you have questions about these Terms, account restrictions,
            or an appeal, contact Shinzi through its designated support
            channel. Official contact details will be provided here
            before public release.
          </p>
        </section>

        <footer
          style={{
            marginTop: '40px',
            paddingTop: '20px',
            borderTop: '1px solid #2a2a2a',
            color: '#8e8e8e',
            fontSize: '14px',
          }}
        >
          © {new Date().getFullYear()} Shinzi. All rights reserved.
        </footer>
      </article>
    </main>
  );
};

export default Terms;
