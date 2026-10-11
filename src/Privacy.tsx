import './Privacy.css';

export default function Privacy() {
  return (
    <main className="privacy-page">
      <article className="privacy-content">
        <header className="privacy-header">
          <p className="privacy-eyebrow">SHINZI • YOUR DATA</p>
          <h1>Privacy Policy</h1>
          <p className="privacy-subtitle">
            How Shinzi handles your personal information.
          </p>
          <p className="privacy-updated">
            Effective date: To be announced
          </p>
        </header>

        <section>
          <h2>1. Introduction</h2>
          <p>
            This policy explains how Shinzi collects, uses, stores, and
            protects information when you use our website and services.
          </p>
        </section>

        <section>
          <h2>2. Information We Collect</h2>
          <ul>
            <li>Email address and account authentication information.</li>
            <li>Display name, username, gender, and date of birth.</li>
            <li>
              Profile photo information, including file details and Google
              Drive file references.
            </li>
            <li>
              Technical information processed by service providers to operate
              and secure the website.
            </li>
          </ul>
        </section>

        <section>
          <h2>3. Date of Birth</h2>
          <p>
            Your date of birth is stored in your Firebase profile. It may be
            used for age eligibility checks and account-related purposes.
            Please provide accurate information.
          </p>
        </section>

        <section>
          <h2>4. How We Use Information</h2>
          <p>We use information, as applicable, to:</p>
          <ul>
            <li>Create and manage accounts and profiles.</li>
            <li>Authenticate users and protect account security.</li>
            <li>Support profile photo uploads.</li>
            <li>Respond to support requests.</li>
            <li>Meet applicable legal obligations.</li>
          </ul>
        </section>

        <section>
          <h2>5. Firebase</h2>
          <p>
            Shinzi uses Firebase for account authentication and profile data.
            Information is processed under the applicable Google service
            terms and privacy practices.
          </p>
        </section>

        <section>
          <h2>6. Google Drive and Photos</h2>
          <p>
            Shinzi uses Google OAuth to let you upload a profile photo to
            Google Drive. Shinzi may store related file references and
            metadata in its database to connect the photo to your profile.
          </p>
          <p>
            You can review or revoke Shinzi's access through your Google
            Account settings. Revoking access may stop connected features
            from working, but does not necessarily delete previously uploaded
            files or stored metadata.
          </p>
          <p>
            Google handles information it processes under its own privacy
            policy. Shinzi does not own your Google account or personal photos.
          </p>
        </section>

        <section>
          <h2>7. Third-Party Services</h2>
          <p>
            Shinzi relies on services such as Firebase, Google Drive, Google
            OAuth, and Vercel hosting. These providers may process information
            under their own policies and applicable legal requirements.
          </p>
          <p>
            We do not sell your personal information as a business practice.
            Information may be disclosed when legally required or reasonably
            necessary to protect the service and its users.
          </p>
        </section>

        <section>
          <h2>8. Security</h2>
          <p>
            We aim to protect information using appropriate security measures.
            However, no online service can guarantee absolute security.
            Keep your password private and contact support if you suspect
            unauthorized account access.
          </p>
        </section>

        <section>
          <h2>9. Data Retention and Deletion</h2>
          <p>
            Information is retained as reasonably necessary to operate
            Shinzi, maintain account records, address security issues, and
            meet legal obligations.
          </p>
          <p>
            <strong>
              Account deletion is currently handled manually through support.
              An in-app self-service deletion feature is not available.
            </strong>
          </p>
          <p>
            Contact Shinzi's official support channel to request account and
            associated data deletion. We may verify your identity first.
            Some information may need to be retained where legally required.
          </p>
          <p>
            Deleting Shinzi records does not automatically delete files or
            information held separately by Google or other providers.
          </p>
        </section>

        <section>
          <h2>10. Children's Privacy</h2>
          <p>
            Users must meet applicable age requirements. Shinzi may use
            date-of-birth information for age eligibility checks. Contact
            support if you have a concern about a child's information.
          </p>
        </section>

        <section>
          <h2>11. Your Choices and Rights</h2>
          <p>
            Depending on applicable law, you may request access to,
            correction of, or deletion of your personal information.
            Contact support to submit a request. You can also manage
            Google authorization in your Google Account settings.
          </p>
        </section>

        <section>
          <h2>12. Policy Changes</h2>
          <p>
            We may update this policy when our services, data practices,
            or legal obligations change. The latest version will appear
            on this page.
          </p>
        </section>

        <section>
          <h2>13. Contact</h2>
          <p>
            For privacy questions or deletion requests, contact Shinzi
            through its official support channel.
          </p>
          <p className="privacy-contact-note">
            Official support email or link: To be added before public release.
          </p>
        </section>

        <footer className="privacy-footer">
          <p>© Shinzi. All rights reserved.</p>
          <p>Privacy matters. Use Shinzi responsibly.</p>
        </footer>
      </article>
    </main>
  );
              }
