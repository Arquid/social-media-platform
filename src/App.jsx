import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Container, Box, CircularProgress } from '@mui/material';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';

// Each page is loaded only when the user first visits it
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Home = lazy(() => import('./pages/Home'));
const Profile = lazy(() => import('./pages/Profile'));
const Notifications = lazy(() => import('./pages/Notifications'));
const PostPage = lazy(() => import('./pages/PostPage'));

function PageFallback() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 10 }}>
      <CircularProgress />
    </Box>
  );
}

export default function App() {
  return (
    <>
      <Navbar />
      <Container maxWidth="sm" sx={{ py: 3 }}>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/profile/:username" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
            <Route path="/post/:id" element={<ProtectedRoute><PostPage /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Container>
    </>
  );
}