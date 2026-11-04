import { useState } from 'react';
import { Tabs, Tab } from '@mui/material';
import PostForm from '../components/PostForm';
import Feed from '../components/Feed';
import PageTitle from '../components/PageTitle';

export default function Home() {
  const [tab, setTab] = useState(0);
  const [newPostId, setNewPostId] = useState(null);

  return (
    <>
      <PageTitle>Home</PageTitle>
      <PostForm onPosted={setNewPostId} />
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="All" />
        <Tab label="Following" />
      </Tabs>
      <Feed key={tab} followingOnly={tab === 1} newPostId={newPostId} />
    </>
  );
}
