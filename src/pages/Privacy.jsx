import { Link as RouterLink } from 'react-router-dom';
import { Link, Typography } from '@mui/material';
import { LegalPage, LegalSection, LegalList } from '../components/LegalPage';

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <Typography>
        This tells what personal data the service holds about you, why, who handles it, how long it is kept and what
        you can do about it. The rules of use are in the{' '}
        <Link component={RouterLink} to="/terms" underline="always">Terms of Use</Link>.
      </Typography>

      <LegalSection title="What we hold about you">
        <LegalList
          items={[
            'Your account: email address, a password (kept only as a one-way hash: nobody can read it), username, and the display name, bio and profile picture you choose to add.',
            'What you make: posts (and their pictures), comments, likes, who you follow and who follows you, the people you block, and the notifications you get.',
            'Reports you send (the reason and the details you write). Reports that other people make about you are kept private for moderation and are not shown to you.',
            'Which version of the terms and of this policy you accepted, and when.',
            'A short log of your recent actions (like posting or liking) that is used to stop abuse. It holds no content.',
            'Technical data such as your IP address and device, which the hosting and sign-in services process to deliver the service and keep it secure.',
            'Only if the person who runs the site has turned error reporting on: the error message and the page address (without the part after ? or #) when something breaks. It holds no name, email or content.',
          ]}
        />
      </LegalSection>

      <LegalSection title="Who can see it">
        <Typography>
          Your username, display name, bio, profile picture, posts, comments and likes can be seen by the other people
          who are logged in to the service. They cannot be seen by people who are not logged in. Your email address
          and your reports are never shown to other users. The people who run the service can read the reports and the
          data in the database in order to run and protect it.
        </Typography>
      </LegalSection>

      <LegalSection title="Why we use it">
        <LegalList
          items={[
            'To give you the service you signed up for: your account, your posts, the feed, notifications and search (this is the agreement between you and us).',
            'To keep the service safe and fair: limits on how fast you can act, reports and moderation (our legitimate interest in protecting the service and its users).',
            'To keep a record that you accepted the terms (you gave your agreement when you signed up).',
            'To follow the law when we must.',
          ]}
        />
        <Typography>We do not sell your data, we do not show advertisements and we do not profile you.</Typography>
      </LegalSection>

      <LegalSection title="Who handles it for us">
        <LegalList
          items={[
            'Supabase: the database, sign-in, file storage and live updates of the service run on Supabase. The data is kept in the region that the person who runs the site chose.',
            'An email service, which delivers the emails of the service (for example to reset a password).',
            'Sentry, only if error reporting is on (see above).',
          ]}
        />
      </LegalSection>

      <LegalSection title="Cookies and similar storage">
        <Typography>
          We set no cookies and use no analytics, advertising or tracking. Your browser stores two things for the
          service to work: your sign-in (so that you stay logged in) and your choice of light or dark theme. Both stay
          on your device.
        </Typography>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <Typography>
          Until you delete your account. Deleting it removes your profile, posts, comments, likes, follows, blocks,
          notifications, the reports you sent, the reports about you, your record of accepted terms and the pictures
          you uploaded, and the log of your recent actions. Copies in backups of the hosting service can remain for a
          limited time after that.
        </Typography>
      </LegalSection>

      <LegalSection title="Your rights">
        <LegalList
          items={[
            'Access and a copy: choose "Download my data" on your own profile page. You get all the data above in one file (reports about you are not in it).',
            'Correction: edit your profile and your posts yourself.',
            'Deletion: choose "Delete account" on your own profile page.',
            'You can also ask us to limit or stop using your data, or complain to the data protection authority of your country.',
          ]}
        />
      </LegalSection>

      <LegalSection title="Children">
        <Typography>The service is only for people who are at least 16 years old.</Typography>
      </LegalSection>

      <LegalSection title="Changes">
        <Typography>
          When this policy changes, the date above changes. If you do not agree with a change, you can delete your account.
        </Typography>
      </LegalSection>
    </LegalPage>
  );
}
