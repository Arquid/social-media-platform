import { useState } from 'react';
import { Tabs, Tab } from '@mui/material';
import PostForm from '../components/PostForm';
import Feed from '../components/Feed';

export default function Home() {
  const [tab, setTab] = useState(0);

  return (
    <>
      <PostForm />
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="All" />
        <Tab label="Following" />
      </Tabs>
      <Feed key={tab} followingOnly={tab === 1} />
    </>
  );
}
