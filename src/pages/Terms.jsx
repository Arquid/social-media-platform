import { Link as RouterLink } from 'react-router-dom';
import { Link, Typography } from '@mui/material';
import { LegalPage, LegalSection, LegalList } from '../components/LegalPage';

export default function Terms() {
  return (
    <LegalPage title="Terms of Use">
      <Typography>
        These terms tell what you can expect from this service and what we expect from you. By creating an account
        you agree to them and to the{' '}
        <Link component={RouterLink} to="/privacy" underline="always">Privacy Policy</Link>.
      </Typography>

      <LegalSection title="Using the service">
        <LegalList
          items={[
            'You must be at least 16 years old.',
            'Give true details when you sign up, and keep your password to yourself. You are responsible for what happens with your account.',
            'One person, one account. Do not use the service for anything other than what it is for: sharing posts and talking with other people.',
          ]}
        />
      </LegalSection>

      <LegalSection title="Your content">
        <Typography>
          What you post (text, pictures, comments, your profile) stays yours. You give us the right to store it and to
          show it to the other people who use the service, because that is what the service does. You are responsible
          for your content: only post what you have the right to post.
        </Typography>
      </LegalSection>

      <LegalSection title="Rules">
        <Typography>You may not use the service to:</Typography>
        <LegalList
          items={[
            'post anything that is against the law, or that sexually exploits or endangers children',
            'threaten, harass, bully or hate people, or encourage violence',
            'pretend to be somebody else',
            'send spam, advertisements nobody asked for, or scams',
            'spread malware, or try to break, overload or get around the protections of the service, including its limits on how fast you can post, like and follow',
            'collect the personal data of other users, or use bots and scripts to read or post in bulk',
          ]}
        />
      </LegalSection>

      <LegalSection title="Reports, blocking and moderation">
        <Typography>
          You can block a person, and you can report a post, a comment or a person if they break these rules. Reports
          are private: the person who is reported is not told who reported them. The people who run the service read
          the reports and may remove content, or limit or close an account that breaks the rules. We try to treat
          everybody fairly, but we do not promise to answer every report.
        </Typography>
      </LegalSection>

      <LegalSection title="Ending your account">
        <Typography>
          You can delete your account at any time from your profile page. It removes your profile, posts, comments,
          likes, follows, notifications and pictures. We may close an account that breaks these terms. What happens to
          your data is described in the{' '}
          <Link component={RouterLink} to="/privacy" underline="always">Privacy Policy</Link>.
        </Typography>
      </LegalSection>

      <LegalSection title="No guarantees">
        <Typography>
          The service is provided as it is. It may be down, change or stop, and we do not promise that it is free of
          mistakes or that your content will always be there, so keep your own copy of what matters to you (you can
          download your data from your profile page). As far as the law allows, we are not responsible for damage
          that comes from using the service or from the content of other users. Nothing in these terms takes away
          rights that the law gives you and that cannot be given up.
        </Typography>
      </LegalSection>

      <LegalSection title="Changes">
        <Typography>
          We may change these terms, for example when the service gets new features. The date above shows when they
          last changed. If you do not agree with a change, you can delete your account.
        </Typography>
      </LegalSection>
    </LegalPage>
  );
}
